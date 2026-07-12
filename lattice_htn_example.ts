import { LatticeAgent, ToolDefinition, CompoundTaskDefinition } from './lattice_bridge';

interface HouseState {
    foundationBuilt: boolean;
    wallsBuilt: boolean;
    roofBuilt: boolean;
    painted: boolean;
}

const BuildFoundation: ToolDefinition<HouseState> = {
    id: "BuildFoundation",
    preconditions: { foundationBuilt: false },
    effects: { foundationBuilt: true },
    execute: async (state) => {
        console.log("[Tool] construyendo cimientos...");
        await new Promise(resolve => setTimeout(resolve, 300));
        return { foundationBuilt: true };
    }
};

const BuildWalls: ToolDefinition<HouseState> = {
    id: "BuildWalls",
    preconditions: { foundationBuilt: true, wallsBuilt: false },
    effects: { wallsBuilt: true },
    execute: async (state) => {
        console.log("[Tool] levantando paredes de ladrillo...");
        await new Promise(resolve => setTimeout(resolve, 300));
        return { wallsBuilt: true };
    }
};

const BuildRoof: ToolDefinition<HouseState> = {
    id: "BuildRoof",
    preconditions: { wallsBuilt: true, roofBuilt: false },
    effects: { roofBuilt: true },
    execute: async (state) => {
        console.log("[Tool] instalando vigas y tejado...");
        await new Promise(resolve => setTimeout(resolve, 300));
        return { roofBuilt: true };
    }
};

const PaintHouse: ToolDefinition<HouseState> = {
    id: "PaintHouse",
    preconditions: { roofBuilt: true, painted: false },
    effects: { painted: true },
    execute: async (state) => {
        console.log("[Tool] pintando exteriores y fachadas...");
        await new Promise(resolve => setTimeout(resolve, 300));
        return { painted: true };
    }
};

async function runHtnWorkflow() {
    const tools = [BuildFoundation, BuildWalls, BuildRoof, PaintHouse];
    
    const compoundTasks: CompoundTaskDefinition<HouseState>[] = [
        {
            id: "BuildHouseCompound",
            methods: [
                {
                    preconditions: {},
                    subTasks: ["BuildFoundation", "BuildWalls", "BuildRoof", "PaintHouse"]
                }
            ]
        }
    ];

    const agent = new LatticeAgent<HouseState>({
        initialState: {
            foundationBuilt: false,
            wallsBuilt: false,
            roofBuilt: false,
            painted: false
        },
        tools,
        goal: {}, // Goal is empty because task network drives decomposition
        tasks: ["BuildHouseCompound"],
        compoundTasks,
        enableWasm: true,
        enableDevTools: false
    });

    console.log("=== INICIANDO PLANIFICADOR JERÁRQUICO HÍBRIDO (HTN) ===");
    try {
        const finalState = await agent.run();
        console.log("Estado Final de la Construcción:", finalState);
    } catch (e: any) {
        console.error("Error en la ejecución:", e.message);
    }
}

runHtnWorkflow();
