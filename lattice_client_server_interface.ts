import { execFileSync, spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as net from 'net';

export type PredicateOperator<T> = 
    | T
    | {
        $eq?: T;
        $ne?: T;
        $gt?: T;
        $gte?: T;
        $lt?: T;
        $lte?: T;
      };

export type Preconditions<T> = {
    [K in keyof T]?: PredicateOperator<T[K]>;
};

export type MutatorOperator<T> =
    | T
    | {
        $set?: T;
        $add?: T;
        $sub?: T;
      };

export type Effects<T> = {
    [K in keyof T]?: MutatorOperator<T[K]>;
};

export interface ToolDefinition<T> {
    id: string;
    preconditions: Preconditions<T>;
    effects: Effects<T>;
    execute: (state: T) => Promise<Partial<T>>;
    cost?: number;
    timeout?: number;
    postDelay?: number;
}

export interface SensorDefinition<T> {
    id: string;
    sense: (state: T) => Promise<Partial<T>>;
}

export interface MethodDefinition<T> {
    preconditions: Preconditions<T>;
    subTasks: string[];
}

export interface CompoundTaskDefinition<T> {
    id: string;
    methods: MethodDefinition<T>[];
}

export interface FieldSchema {
    type: 'number' | 'boolean' | 'string' | 'object' | 'array';
    min?: number;
    max?: number;
    required?: boolean;
}

export type StateSchema<T> = {
    [K in keyof T]?: FieldSchema;
};

export interface AgentConfig<T> {
    initialState: T;
    tools: ToolDefinition<T>[];
    goal: Preconditions<T>;
    cachePath?: string;
    enableDevTools?: boolean;
    enableWasm?: boolean;
    maxReplans?: number;
    tasks?: string[];
    compoundTasks?: CompoundTaskDefinition<T>[];
    sensors?: SensorDefinition<T>[];
    schema?: StateSchema<T>;
}

interface RustPlanningRequest {
    initial_state: Record<string, any>;
    goal: Record<string, any>;
    tools: Array<{
        id: string;
        preconditions: Record<string, any>;
        effects: Record<string, any>;
    }>;
    cache_path?: string;
    cache_data?: Record<string, string[]>;
    tasks?: string[];
    compound_tasks?: Array<{
        id: string;
        methods: Array<{
            preconditions: Record<string, any>;
            sub_tasks: string[];
        }>;
    }>;
}

interface SearchStep {
    state: Record<string, any>;
    parent_state: Record<string, any> | null;
    action: string | null;
    g: number;
    h: number;
    f: number;
}

interface RustPlanningResponse {
    success: boolean;
    plan?: string[];
    plan_tiers?: string[][];
    telemetry?: SearchStep[];
    cache_data?: Record<string, string[]>;
    error?: string;
    from_cache: boolean;
}

interface VisualNode {
    state: any;
    action?: string;
    g: number;
    h: number;
    f: number;
    children: VisualNode[];
    isChosenPath: boolean;
}

function buildSearchTree(telemetry: SearchStep[], finalPlan: string[]): VisualNode {
    const stateEquals = (s1: any, s2: any) => {
        if (!s1 || !s2) return false;
        const keys1 = Object.keys(s1);
        const keys2 = Object.keys(s2);
        if (keys1.length !== keys2.length) return false;
        for (const k of keys1) {
            if (JSON.stringify(s1[k]) !== JSON.stringify(s2[k])) return false;
        }
        return true;
    };

    const rootStep = telemetry.find(s => !s.parent_state) || telemetry[0];
    if (!rootStep) {
        throw new Error("No telemetry steps found");
    }

    const root: VisualNode = {
        state: rootStep.state,
        action: rootStep.action || undefined,
        g: rootStep.g,
        h: rootStep.h,
        f: rootStep.f,
        children: [],
        isChosenPath: false
    };

    const findAndAttach = (node: VisualNode, step: SearchStep): boolean => {
        if (stateEquals(node.state, step.parent_state)) {
            const childNode: VisualNode = {
                state: step.state,
                action: step.action || undefined,
                g: step.g,
                h: step.h,
                f: step.f,
                children: [],
                isChosenPath: false
            };
            node.children.push(childNode);
            return true;
        }
        for (const child of node.children) {
            if (findAndAttach(child, step)) {
                return true;
            }
        }
        return false;
    };

    for (const step of telemetry) {
        if (step === rootStep) continue;
        findAndAttach(root, step);
    }

    const markChosenPath = (node: VisualNode, planIndex: number) => {
        node.isChosenPath = true;
        if (planIndex >= finalPlan.length) return;
        const nextAction = finalPlan[planIndex];
        const nextNode = node.children.find(c => c.action === nextAction);
        if (nextNode) {
            markChosenPath(nextNode, planIndex + 1);
        }
    };

    markChosenPath(root, 0);

    return root;
}

function printSearchTree(node: VisualNode, prefix: string = '', isLast: boolean = true) {
    const GREEN = '\x1b[32m';
    const YELLOW = '\x1b[33m';
    const GRAY = '\x1b[90m';
    const RESET = '\x1b[0m';
    const BOLD = '\x1b[1m';

    const branch = isLast ? '└── ' : '├── ';
    const nextPrefix = prefix + (isLast ? '    ' : '│   ');

    const color = node.isChosenPath ? GREEN : YELLOW;
    const actionStr = node.action ? `${BOLD}${color}[${node.action}]${RESET} ` : `${BOLD}${GRAY}[Start]${RESET} `;
    const stateStr = GRAY + JSON.stringify(node.state) + RESET;
    const scoreStr = `${GRAY}(g=${node.g}, h=${node.h}, f=${node.f})${RESET}`;

    console.log(`${prefix}${branch}${actionStr}${scoreStr} -> State: ${stateStr}`);

    for (let i = 0; i < node.children.length; i++) {
        const isChildLast = i === node.children.length - 1;
        printSearchTree(node.children[i], nextPrefix, isChildLast);
    }
}

function validateStateSchema<T>(state: any, schema: StateSchema<T>): string[] {
    const errors: string[] = [];
    for (const key in schema) {
        const field = schema[key];
        if (!field) continue;
        
        const value = state[key];
        if (value === undefined || value === null) {
            if (field.required) {
                errors.push(`Field '${key}' is required but was not found.`);
            }
            continue;
        }

        const actualType = typeof value;
        if (field.type === 'array') {
            if (!Array.isArray(value)) {
                errors.push(`Field '${key}' expected array, got ${actualType}.`);
            }
        } else {
            if (actualType !== field.type) {
                errors.push(`Field '${key}' expected type ${field.type}, got ${actualType}.`);
            }
        }

        if (field.type === 'number' && typeof value === 'number') {
            if (field.min !== undefined && value < field.min) {
                errors.push(`Field '${key}' value ${value} is less than minimum ${field.min}.`);
            }
            if (field.max !== undefined && value > field.max) {
                errors.push(`Field '${key}' value ${value} is greater than maximum ${field.max}.`);
            }
        }
    }
    return errors;
}

function serializeState(state: any): Record<string, any> {
    const serialized: Record<string, any> = {};
    const obj = state;
    for (const key in obj) {
        if (obj[key] !== undefined) {
            serialized[key] = obj[key];
        }
    }
    return serialized;
}

// Precondition match checker
function matchCondition(actual: any, expected: any): boolean {
    if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
        for (const op in expected) {
            const val = expected[op];
            switch (op) {
                case '$eq':
                    if (actual !== val) return false;
                    break;
                case '$ne':
                    if (actual === val) return false;
                    break;
                case '$gt':
                    if (typeof actual !== 'number' || typeof val !== 'number' || actual <= val) return false;
                    break;
                case '$gte':
                    if (typeof actual !== 'number' || typeof val !== 'number' || actual < val) return false;
                    break;
                case '$lt':
                    if (typeof actual !== 'number' || typeof val !== 'number' || actual >= val) return false;
                    break;
                case '$lte':
                    if (typeof actual !== 'number' || typeof val !== 'number' || actual > val) return false;
                    break;
                default:
                    return false;
            }
        }
        return true;
    }
    return actual === expected;
}

// Effect contract verifier
function verifyEffect(oldVal: any, newVal: any, effect: any): boolean {
    if (effect && typeof effect === 'object' && !Array.isArray(effect)) {
        for (const op in effect) {
            const arg = effect[op];
            switch (op) {
                case '$set':
                    if (newVal !== arg) return false;
                    break;
                case '$add':
                    if (typeof oldVal !== 'number' || typeof newVal !== 'number' || typeof arg !== 'number') return false;
                    if (newVal !== oldVal + arg) return false;
                    break;
                case '$sub':
                    if (typeof oldVal !== 'number' || typeof newVal !== 'number' || typeof arg !== 'number') return false;
                    if (newVal !== oldVal - arg) return false;
                    break;
                default:
                    return false;
            }
        }
        return true;
    }
    return newVal === effect;
}

class WasmBridge {
    private instance!: WebAssembly.Instance;

    constructor(private wasmPath: string) {}

    public async init() {
        const wasmBuffer = fs.readFileSync(this.wasmPath);
        const module = await WebAssembly.compile(wasmBuffer);
        this.instance = await WebAssembly.instantiate(module);
    }

    public plan(requestPayload: any): any {
        const exports = this.instance.exports as any;
        const requestStr = JSON.stringify(requestPayload);
        const requestBytes = Buffer.from(requestStr, 'utf8');
        const size = requestBytes.length;

        const inputPtr = exports.alloc(size);
        if (!inputPtr) {
            throw new Error("Failed to allocate memory in WASM heap");
        }

        const wasmMem = new Uint8Array(exports.memory.buffer);
        wasmMem.set(requestBytes, inputPtr);

        const outputPtr = exports.plan_wasm(inputPtr, size);

        const memBuffer = new Uint8Array(exports.memory.buffer);
        let endIdx = outputPtr;
        while (memBuffer[endIdx] !== 0) {
            endIdx++;
        }
        const responseBytes = memBuffer.slice(outputPtr, endIdx);
        const responseStr = Buffer.from(responseBytes).toString('utf8');

        exports.dealloc(inputPtr, size);
        exports.dealloc(outputPtr, responseBytes.length + 1);

        return JSON.parse(responseStr);
    }
}

export class LatticeAgent<T extends Record<string, any>> {
    private state: T;

    constructor(private config: AgentConfig<T>) {
        this.state = { ...config.initialState };
        if (config.schema) {
            const errors = validateStateSchema(this.state, config.schema);
            if (errors.length > 0) {
                throw new Error(`Initial state schema validation failed:\n- ${errors.join('\n- ')}`);
            }
        }
    }

    private async runSensors(): Promise<void> {
        if (!this.config.sensors || this.config.sensors.length === 0) return;
        console.log(`[Lattice] Running ${this.config.sensors.length} sensors...`);
        for (const sensor of this.config.sensors) {
            try {
                const percepts = await sensor.sense(this.state);
                this.state = {
                    ...this.state,
                    ...percepts
                };
                console.log(`[Lattice] Sensor ${sensor.id} sensed updates:`, percepts);
            } catch (e: any) {
                console.log(`[Lattice] Sensor ${sensor.id} failed: ${e.message}`);
            }
        }
    }

    private findRustBinary(): string {
        // The Cargo bin target is `lattice-daemon`; `lattice` is kept as a
        // legacy fallback for older builds. Windows appends `.exe`.
        const roots = [__dirname, process.cwd()];
        const profiles = ['release', 'debug'];
        const names = ['lattice-daemon', 'lattice', 'Lattice'];
        const exts = ['.exe', ''];

        for (const root of roots) {
            for (const profile of profiles) {
                for (const name of names) {
                    for (const ext of exts) {
                        const p = path.join(root, 'target', profile, name + ext);
                        if (fs.existsSync(p)) {
                            return p;
                        }
                    }
                }
            }
        }
        throw new Error("Rust planner binary not found. Please run 'cargo build --release' first.");
    }

    private findWasmBinary(): string {
        const paths = [
            path.join(__dirname, 'target', 'wasm32-unknown-unknown', 'release', 'lattice.wasm'),
            path.join(__dirname, 'target', 'wasm32-unknown-unknown', 'debug', 'lattice.wasm'),
            path.join(process.cwd(), 'target', 'wasm32-unknown-unknown', 'release', 'lattice.wasm'),
            path.join(process.cwd(), 'target', 'wasm32-unknown-unknown', 'debug', 'lattice.wasm'),
        ];
        for (const p of paths) {
            if (fs.existsSync(p)) {
                return p;
            }
        }
        throw new Error("WASM planner binary not found. Please run 'cargo build --target wasm32-unknown-unknown --release' first.");
    }

    private async sendRequestViaDaemon(requestPayload: RustPlanningRequest): Promise<string> {
        const port = 1999;
        
        const connectAndSend = (): Promise<string> => {
            return new Promise<string>((resolve, reject) => {
                const client = net.createConnection({ port, host: '127.0.0.1' }, () => {
                    client.write(JSON.stringify(requestPayload));
                    client.end();
                });
                let data = '';
                client.on('data', (chunk) => {
                    data += chunk.toString();
                });
                client.on('end', () => {
                    resolve(data);
                });
                client.on('error', (err) => {
                    reject(err);
                });
            });
        };

        try {
            return await connectAndSend();
        } catch (err: any) {
            if (err.code === 'ECONNREFUSED') {
                console.log(`[Lattice] Daemon not running on port ${port}. Spawning background server...`);
                const binaryPath = this.findRustBinary();
                
                const daemon = spawn(binaryPath, ['--server', port.toString()], {
                    stdio: ['ignore', 'pipe', 'inherit'],
                    detached: true
                });

                await new Promise<void>((resolve, reject) => {
                    let resolved = false;
                    daemon.stdout!.on('data', (chunk) => {
                        if (chunk.toString().includes('LATTICE_SERVER_READY')) {
                            resolved = true;
                            daemon.stdout!.destroy();
                            daemon.unref();
                            resolve();
                        }
                    });
                    daemon.on('error', (e) => {
                        if (!resolved) reject(e);
                    });
                    daemon.on('exit', (code) => {
                        if (!resolved) reject(new Error(`Daemon exited with code ${code} before ready signal`));
                    });
                });

                console.log(`[Lattice] Background daemon spawned successfully on port ${port}.`);
                return await connectAndSend();
            } else {
                throw err;
            }
        }
    }

    private async getPlan(): Promise<RustPlanningResponse> {
        const requestPayload: RustPlanningRequest = {
            initial_state: serializeState(this.state),
            goal: serializeState(this.config.goal),
            tools: this.config.tools.map(t => ({
                id: t.id,
                preconditions: serializeState(t.preconditions),
                effects: serializeState(t.effects),
                cost: t.cost
            })),
            tasks: this.config.tasks,
            compound_tasks: this.config.compoundTasks?.map(ct => ({
                id: ct.id,
                methods: ct.methods.map(m => ({
                    preconditions: serializeState(m.preconditions),
                    sub_tasks: m.subTasks
                }))
            }))
        };

        const cachePath = this.config.cachePath || path.join(process.cwd(), '.lattice_cache.json');
        const useWasm = this.config.enableWasm !== false;
        let wasmPath = '';
        if (useWasm) {
            try {
                wasmPath = this.findWasmBinary();
            } catch (e) {
                if (this.config.enableWasm === true) {
                    throw e;
                }
            }
        }

        const startIpcTime = Date.now();
        let response: RustPlanningResponse;

        if (useWasm && wasmPath) {
            console.log(`[Lattice] Invoking Rust planner in-process via WebAssembly: ${wasmPath}`);
            let cacheData: any = null;
            if (fs.existsSync(cachePath)) {
                try {
                    cacheData = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
                } catch (e: any) {
                    console.log(`[Lattice] Warning: failed to read cache file: ${e.message}`);
                }
            }
            requestPayload.cache_data = cacheData;

            const bridge = new WasmBridge(wasmPath);
            await bridge.init();
            response = bridge.plan(requestPayload);

            if (response.cache_data) {
                try {
                    fs.writeFileSync(cachePath, JSON.stringify(response.cache_data));
                } catch (e: any) {
                    console.log(`[Lattice] Warning: failed to write cache file: ${e.message}`);
                }
            }
        } else {
            requestPayload.cache_path = cachePath;
            const stdoutStr = await this.sendRequestViaDaemon(requestPayload);
            try {
                response = JSON.parse(stdoutStr);
            } catch (e: any) {
                throw new Error(`Failed to parse Rust planner response: ${stdoutStr}`);
            }
        }

        const ipcDuration = Date.now() - startIpcTime;
        console.log(`[Lattice] IPC/WASM planning transaction took ${ipcDuration}ms.`);
        return response;
    }

    public async run(): Promise<T> {
        console.log(`[Lattice] Starting agent execution...`);
        console.log(`[Lattice] Initial State:`, this.state);
        console.log(`[Lattice] Goal:`, this.config.goal);

        await this.runSensors();

        let replans = 0;
        const maxReplans = this.config.maxReplans ?? 5;
        const isHtn = this.config.tasks && this.config.tasks.length > 0;

        while (true) {
            if (!isHtn) {
                let goalMet = true;
                for (const key in this.config.goal) {
                    const actual = this.state[key];
                    const expected = (this.config.goal as any)[key];
                    if (!matchCondition(actual, expected)) {
                        goalMet = false;
                        break;
                    }
                }

                if (goalMet) {
                    console.log(`[Lattice] Goal successfully reached.`);
                    return this.state;
                }
            }

            const response = await this.getPlan();

            if (!response.success) {
                throw new Error(`Rust Planner Error: ${response.error}`);
            }

            const planTiers = response.plan_tiers || [];
            const plan = response.plan || [];

            if (planTiers.length === 0) {
                console.log(`[Lattice] Execution complete: Goal already met.`);
                return this.state;
            }

            console.log(`[Lattice] Plan generated (From Cache: ${response.from_cache}) with ${planTiers.length} execution tiers.`);

            if (response.telemetry && this.config.enableDevTools && !response.from_cache) {
                console.log("\n\x1b[1m\x1b[36m=== LATTICE DEVTOOLS: STATE-SPACE SEARCH TREE ===\x1b[0m");
                try {
                    const tree = buildSearchTree(response.telemetry, plan);
                    printSearchTree(tree);
                } catch (e: any) {
                    console.log("[DevTools] Failed to render search tree:", e.message);
                }
                console.log("\x1b[1m\x1b[36m================================================\x1b[0m\n");

                try {
                    const htmlContent = generateDevToolsHtml(response.telemetry, plan);
                    const htmlPath = path.join(process.cwd(), 'lattice_devtools.html');
                    fs.writeFileSync(htmlPath, htmlContent);
                    console.log(`[Lattice] DevTools interactive visualizer generated at: ${htmlPath}`);
                } catch (e: any) {
                    console.log("[DevTools] Failed to generate HTML visualizer:", e.message);
                }
            }

            let planFailed = false;

            for (let tierIdx = 0; tierIdx < planTiers.length; tierIdx++) {
                await this.runSensors();

                const tier = planTiers[tierIdx];
                console.log(`[Lattice] Executing Tier ${tierIdx} in parallel:`, tier);

                let tierPreconditionsMet = true;
                for (const toolId of tier) {
                    const tool = this.config.tools.find(t => t.id === toolId);
                    if (!tool) {
                        throw new Error(`Critical Error: Plan contains unknown tool: ${toolId}`);
                    }
                    for (const key in tool.preconditions) {
                        const actual = this.state[key];
                        const expected = (tool.preconditions as any)[key];
                        if (!matchCondition(actual, expected)) {
                            console.log(`[Lattice] [Precondition Failed] Tool ${toolId} precondition failed for key: ${key}. Expected: ${JSON.stringify(expected)}, Actual: ${actual}`);
                            tierPreconditionsMet = false;
                            break;
                        }
                    }
                    if (!tierPreconditionsMet) break;
                }

                if (!tierPreconditionsMet) {
                    console.log(`[Lattice] [Self-Correction] Preconditions failed for tier ${tierIdx}. Aborting tier execution and replanning.`);
                    planFailed = true;
                    break;
                }

                const oldState = { ...this.state };
                let results: Array<{ toolId: string, tool: any, changes: any, failed: boolean, error?: any }> = [];

                try {
                    const executionPromises = tier.map(async (toolId) => {
                        const tool = this.config.tools.find(t => t.id === toolId)!;
                        try {
                            console.log(`[Lattice] [Concurrente] Iniciando execution of tool: ${toolId}`);
                            let executionPromise = tool.execute(oldState);
                            const timeoutMs = tool.timeout ?? 0;
                            const postDelayMs = tool.postDelay ?? 0;

                            if (timeoutMs > 0) {
                                const timeoutPromise = new Promise<never>((_, reject) =>
                                    setTimeout(() => reject(new Error(`Tool ${tool.id} timed out after ${timeoutMs}ms`)), timeoutMs)
                                );
                                executionPromise = Promise.race([executionPromise, timeoutPromise]);
                            }

                            const changes = await executionPromise;

                            if (postDelayMs > 0) {
                                console.log(`[Lattice] Waiting post-delay of ${postDelayMs}ms after tool ${tool.id}...`);
                                await new Promise(resolve => setTimeout(resolve, postDelayMs));
                            }

                            return { toolId, tool, changes, failed: false };
                        } catch (err: any) {
                            console.log(`[Lattice] [Tool Failure] Tool ${toolId} threw an error: ${err.message}`);
                            return { toolId, tool, changes: {}, failed: true, error: err };
                        }
                    });
                    results = await Promise.all(executionPromises);
                } catch (e: any) {
                    console.log(`[Lattice] [Self-Correction] Tier execution crashed: ${e.message}`);
                    planFailed = true;
                    break;
                }

                if (results.some(r => r.failed)) {
                    console.log(`[Lattice] [Self-Correction] One or more tools failed to execute. Aborting tier execution and replanning.`);
                    planFailed = true;
                    break;
                }

                let mergedChanges = {};
                for (const res of results) {
                    mergedChanges = {
                        ...mergedChanges,
                        ...res.changes
                    };
                }

                this.state = {
                    ...this.state,
                    ...mergedChanges
                };

                if (this.config.schema) {
                    const schemaErrors = validateStateSchema(this.state, this.config.schema);
                    if (schemaErrors.length > 0) {
                        console.log(`[Lattice] [Schema Violation] State validation failed after executing tier ${tierIdx}:\n- ${schemaErrors.join('\n- ')}`);
                        this.state = oldState;
                        planFailed = true;
                        break;
                    }
                }

                let tierEffectsVerified = true;
                for (const res of results) {
                    for (const key in res.tool.effects) {
                        const oldVal = oldState[key];
                        const newVal = this.state[key];
                        const effect = (res.tool.effects as any)[key];
                        if (!verifyEffect(oldVal, newVal, effect)) {
                            console.log(`[Lattice] [Effect Violation] Tool ${res.toolId} failed effect contract for key: ${key}. Expected: ${JSON.stringify(effect)}. Old: ${oldVal}, New: ${newVal}`);
                            tierEffectsVerified = false;
                            break;
                        }
                    }
                    if (!tierEffectsVerified) break;
                }

                if (!tierEffectsVerified) {
                    console.log(`[Lattice] [Self-Correction] Effect contracts violated for tier ${tierIdx}. Aborting tier execution and replanning.`);
                    planFailed = true;
                    break;
                }

                console.log(`[Lattice] Tier ${tierIdx} completed successfully.`);
            }

            if (planFailed) {
                replans++;
                if (replans > maxReplans) {
                    throw new Error(`[Lattice] Self-Correction failed: Exceeded maximum replan threshold of ${maxReplans}.`);
                }
                console.log(`\n\x1b[1m\x1b[33m[Lattice] [Self-Correction] Replanning #${replans} from current state...\x1b[0m\n`);
                continue;
            }

            if (isHtn) {
                console.log(`[Lattice] HTN tasks executed successfully.`);
                return this.state;
            }

            let finalGoalMet = true;
            for (const key in this.config.goal) {
                if (!matchCondition(this.state[key], (this.config.goal as any)[key])) {
                    finalGoalMet = false;
                    break;
                }
            }

            if (finalGoalMet) {
                console.log(`[Lattice] Goal successfully reached.`);
                return this.state;
            } else {
                console.log(`[Lattice] [Self-Correction] Execution completed but goal was not fully met. Initiating final replan...`);
                replans++;
                if (replans > maxReplans) {
                    throw new Error(`[Lattice] Self-Correction failed: Goal not met after max replans.`);
                }
                continue;
            }
        }
    }
}

function generateDevToolsHtml(telemetry: SearchStep[], plan: string[]): string {
    const telemetryJson = JSON.stringify(telemetry);
    const planJson = JSON.stringify(plan);
    
    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Lattice Agent DevTools</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://d3js.org/d3.v7.min.js"></script>
    <style>
        .link {
            fill: none;
        }
        .glow {
            filter: drop-shadow(0 0 5px rgba(34, 197, 94, 0.8));
        }
        body {
            background-color: #0b0f19;
            color: #f1f5f9;
        }
    </style>
</head>
<body class="flex flex-col h-screen overflow-hidden font-sans">
    <!-- Header -->
    <header class="bg-[#111827] border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div>
            <h1 class="text-xl font-bold tracking-tight text-white flex items-center gap-2">
                <span class="text-indigo-500">🌀</span> Lattice DevTools
            </h1>
            <p class="text-xs text-gray-400 mt-0.5">Visualizador Interactivo del Espacio de Búsqueda A*</p>
        </div>
        <div class="flex items-center gap-4">
            <span class="text-xs px-2.5 py-1 bg-green-500/10 text-green-400 border border-green-500/20 rounded-full font-medium flex items-center gap-1.5">
                <span class="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse"></span>
                WASM In-Process
            </span>
        </div>
    </header>

    <!-- Content -->
    <div class="flex flex-1 overflow-hidden">
        <!-- Left Sidebar: Overview -->
        <aside class="w-80 bg-[#111827]/50 border-r border-gray-800 p-5 flex flex-col gap-6 overflow-y-auto">
            <div>
                <h3 class="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3">Plan Resuelto</h3>
                <div class="flex flex-col gap-2" id="plan-list">
                    <!-- Injected dynamically -->
                </div>
            </div>
            <div>
                <h3 class="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3">Estadísticas de Búsqueda</h3>
                <div class="grid grid-cols-2 gap-3 bg-gray-900/50 border border-gray-800/80 rounded-lg p-3">
                    <div>
                        <div class="text-xs text-gray-500">Nodos Visitados</div>
                        <div class="text-lg font-bold text-white" id="stat-visited">0</div>
                    </div>
                    <div>
                        <div class="text-xs text-gray-500">Nivel Máximo</div>
                        <div class="text-lg font-bold text-white" id="stat-depth">0</div>
                    </div>
                </div>
            </div>
        </aside>

        <!-- Center SVG Canvas -->
        <main class="flex-1 relative bg-[#0b0f19] flex items-center justify-center">
            <div class="absolute top-4 left-4 z-10 bg-gray-900/80 border border-gray-800 rounded-lg px-3 py-1.5 text-xs text-gray-400 select-none pointer-events-none">
                💡 Arrastra para panear | Rueda del mouse para zoom | Clic en nodo para inspeccionar
            </div>
            <svg id="canvas" class="w-full h-full cursor-grab active:cursor-grabbing"></svg>
        </main>

        <!-- Right Sidebar: Inspector -->
        <aside class="w-96 bg-[#111827]/50 border-l border-gray-800 p-5 flex flex-col gap-4 overflow-y-auto" id="inspector">
            <h3 class="text-sm font-semibold text-gray-300 uppercase tracking-wider border-b border-gray-800 pb-2">Inspector de Estado</h3>
            <div class="text-xs text-gray-400" id="inspector-placeholder">Selecciona un nodo del árbol para inspeccionar sus variables.</div>
            
            <div id="inspector-content" class="hidden flex flex-col gap-4">
                <div>
                    <div class="text-xs text-gray-500">Acción Ejecutada</div>
                    <div class="text-sm font-semibold text-indigo-400" id="inspect-action">-</div>
                </div>
                
                <div class="grid grid-cols-3 gap-2 bg-gray-900/50 border border-gray-800 p-2.5 rounded-lg text-center">
                    <div>
                        <div class="text-[10px] text-gray-500">Costo (g)</div>
                        <div class="text-sm font-bold text-white" id="inspect-g">0</div>
                    </div>
                    <div>
                        <div class="text-[10px] text-gray-500">Heurística (h)</div>
                        <div class="text-sm font-bold text-white" id="inspect-h">0</div>
                    </div>
                    <div>
                        <div class="text-[10px] text-gray-500">Total (f)</div>
                        <div class="text-sm font-bold text-indigo-400" id="inspect-f">0</div>
                    </div>
                </div>

                <div>
                    <div class="text-xs text-gray-500 mb-1.5">Variables de Memoria</div>
                    <pre class="bg-gray-900 border border-gray-800 rounded-lg p-3 text-xs font-mono text-green-400 overflow-x-auto" id="inspect-state">{}</pre>
                </div>
            </div>
        </aside>
    </div>

    <!-- Script Block -->
    <script>
        const telemetry = ${telemetryJson};
        const finalPlan = ${planJson};

        // Render stats
        document.getElementById('stat-visited').innerText = telemetry.length;

        // Build tree
        const stateEquals = (s1, s2) => {
            if (!s1 || !s2) return false;
            const keys1 = Object.keys(s1);
            const keys2 = Object.keys(s2);
            if (keys1.length !== keys2.length) return false;
            for (const k of keys1) {
                if (JSON.stringify(s1[k]) !== JSON.stringify(s2[k])) return false;
            }
            return true;
        };

        const rootStep = telemetry.find(s => !s.parent_state) || telemetry[0];
        const root = {
            state: rootStep.state,
            action: rootStep.action || 'Start',
            g: rootStep.g,
            h: rootStep.h,
            f: rootStep.f,
            children: [],
            isChosenPath: false
        };

        const findAndAttach = (node, step) => {
            if (stateEquals(node.state, step.parent_state)) {
                const childNode = {
                    state: step.state,
                    action: step.action || undefined,
                    g: step.g,
                    h: step.h,
                    f: step.f,
                    children: [],
                    isChosenPath: false
                };
                node.children.push(childNode);
                return true;
            }
            for (const child of node.children) {
                if (findAndAttach(child, step)) {
                    return true;
                }
            }
            return false;
        };

        for (const step of telemetry) {
            if (step === rootStep) continue;
            findAndAttach(root, step);
        }

        const markChosenPath = (node, planIndex) => {
            node.isChosenPath = true;
            if (planIndex >= finalPlan.length) return;
            const nextAction = finalPlan[planIndex];
            const nextNode = node.children.find(c => c.action === nextAction);
            if (nextNode) {
                markChosenPath(nextNode, planIndex + 1);
            }
        };
        markChosenPath(root, 0);

        // Find max depth of tree
        const getDepth = (node) => {
            if (!node.children || node.children.length === 0) return 1;
            return 1 + Math.max(...node.children.map(getDepth));
        };
        document.getElementById('stat-depth').innerText = getDepth(root);

        // Render Plan list
        const planList = document.getElementById('plan-list');
        finalPlan.forEach((action, idx) => {
            const item = document.createElement('div');
            item.className = 'flex items-center gap-3 bg-gray-900 border border-gray-800 px-3 py-2 rounded-lg';
            item.innerHTML = \`
                <span class="text-xs font-mono bg-indigo-500/20 text-indigo-400 w-5 h-5 rounded-full flex items-center justify-center font-bold">\${idx + 1}</span>
                <span class="text-sm font-semibold text-gray-200">\${action}</span>
            \`;
            planList.appendChild(item);
        });

        // SVG D3 rendering
        const svg = d3.select("#canvas");
        const width = window.innerWidth - 320 - 384;
        const height = window.innerHeight - 80;

        const gContainer = svg.append("g");

        // Zoom setup
        svg.call(d3.zoom().on("zoom", (event) => {
            gContainer.attr("transform", event.transform);
        }));

        const treeLayout = d3.tree().nodeSize([80, 260]);
        const d3Root = d3.hierarchy(root);
        treeLayout(d3Root);

        // Links
        gContainer.selectAll(".link")
            .data(d3Root.links())
            .enter()
            .append("path")
            .attr("class", d3Link => \`link \${d3Link.target.data.isChosenPath ? 'stroke-green-500 glow' : 'stroke-gray-700'}\`)
            .attr("stroke-dasharray", d3Link => d3Link.target.data.isChosenPath ? null : "4,4")
            .attr("stroke-width", d3Link => d3Link.target.data.isChosenPath ? 3 : 1.5)
            .attr("d", d3.linkHorizontal()
                .x(d => d.y)
                .y(d => d.x)
            );

        // Nodes
        const nodes = gContainer.selectAll(".node")
            .data(d3Root.descendants())
            .enter()
            .append("g")
            .attr("class", "node cursor-pointer")
            .attr("transform", d => \`translate(\${d.y},\${d.x})\`)
            .on("click", (event, d) => {
                showInspector(d.data);
            });

        nodes.append("circle")
            .attr("r", 8)
            .attr("class", d => d.data.isChosenPath ? 'glow' : '')
            .attr("stroke", d => d.data.isChosenPath ? "#22c55e" : "#eab308")
            .attr("fill", d => d.data.isChosenPath ? "#22c55e" : "#1e293b");

        nodes.append("text")
            .attr("dy", ".31em")
            .attr("x", d => d.children ? -12 : 12)
            .attr("text-anchor", d => d.children ? "end" : "start")
            .text(d => d.data.action || 'Start')
            .attr("class", "font-semibold tracking-wide")
            .attr("fill", d => d.data.isChosenPath ? "#fff" : "#cbd5e1");

        // Center visualizer initially
        const bounds = gContainer.node().getBBox();
        const initialScale = 0.8;
        const transform = d3.zoomIdentity
            .translate(100, height / 2)
            .scale(initialScale);
        svg.call(d3.zoom().transform, transform);

        // Inspector logic
        const showInspector = (data) => {
            document.getElementById('inspector-placeholder').classList.add('hidden');
            document.getElementById('inspector-content').classList.remove('hidden');
            document.getElementById('inspect-action').innerText = data.action || 'Start';
            document.getElementById('inspect-g').innerText = data.g;
            document.getElementById('inspect-h').innerText = data.h;
            document.getElementById('inspect-f').innerText = data.f;
            document.getElementById('inspect-state').innerText = JSON.stringify(data.state, null, 2);
        };
    </script>
</body>
</html>`;
}