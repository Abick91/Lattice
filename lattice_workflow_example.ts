import { LatticeAgent, ToolDefinition, SensorDefinition, StateSchema } from './lattice_bridge';

interface LedgerState {
    balance: number;
    invoiceApproved: boolean;
    fundsDisbursed: boolean;
    identityVerified: boolean;
    reconciliationReportSent: boolean;
    externalBlocker: boolean; // Controla bloqueo dinámico del entorno
}

// Variable global para simular el evento externo detectado por el sensor
let externalDepositArrived = false;

// 1. Herramienta para depositar fondos adicionales (si el balance es insuficiente) - Costosa
const DepositCollateral: ToolDefinition<LedgerState> = {
    id: "DepositCollateral",
    preconditions: {
        balance: { $lt: 100 }
    },
    effects: {
        balance: { $add: 50 }
    },
    cost: 10, // Costo elevado para que A* prefiera alternativas
    execute: async (state) => {
        console.log(`[Tool] [Async] Depositando colateral... Balance previo: ${state.balance}`);
        await new Promise(resolve => setTimeout(resolve, 500));
        console.log(`[Tool] [Async] Colateral depositado con éxito.`);
        return { balance: state.balance + 50 };
    }
};

let failureAttempts = 1;

// 2. Herramienta para verificar identidad corporativa - Con control de Timeout
const VerifyIdentity: ToolDefinition<LedgerState> = {
    id: "VerifyIdentity",
    preconditions: {
        identityVerified: false
    },
    effects: {
        identityVerified: true
    },
    timeout: 1000, // Límite de 1 segundo
    execute: async (state) => {
        console.log(`[Tool] [Async] Verificando identidad de las cuentas en lista blanca KYC...`);
        
        if (failureAttempts > 0) {
            failureAttempts--;
            console.log(`[Tool] [Simulado] Retrasando KYC para simular un timeout (1200ms)...`);
            await new Promise(resolve => setTimeout(resolve, 1200));
            return { identityVerified: true };
        }
        
        await new Promise(resolve => setTimeout(resolve, 400));
        
        // Simulación: Durante la ejecución, ocurre un evento externo que bloquea la cuenta
        console.log(`[Simulación Externa] Se activa bloqueo de seguridad en la cámara de compensación.`);
        externalDepositArrived = true;
        
        console.log(`[Tool] [Async] Identidad verificada con éxito.`);
        return { identityVerified: true };
    }
};

let corruptDepositAttempt = true;

// Nueva herramienta: Depósito instantáneo rápido y económico, pero requiere KYC
const InstantDeposit: ToolDefinition<LedgerState> = {
    id: "InstantDeposit",
    preconditions: {
        balance: { $lt: 100 },
        identityVerified: true
    },
    effects: {
        balance: { $add: 50 }
    },
    cost: 1, // Extremadamente barata
    execute: async (state) => {
        console.log(`[Tool] [Async] Realizando depósito instantáneo... Balance previo: ${state.balance}`);
        await new Promise(resolve => setTimeout(resolve, 200));
        
        if (corruptDepositAttempt) {
            corruptDepositAttempt = false;
            console.log(`[Tool] [Simulado] Corrompiendo balance retorno: -50 (viola restricción balance >= 0)`);
            return { balance: -50 };
        }
        
        console.log(`[Tool] [Async] Depósito instantáneo realizado.`);
        return { balance: state.balance + 50 };
    }
};

// 3. Herramienta para remover el bloqueo externo
const ClearBlocker: ToolDefinition<LedgerState> = {
    id: "ClearBlocker",
    preconditions: {
        externalBlocker: true
    },
    effects: {
        externalBlocker: false
    },
    execute: async (state) => {
        console.log(`[Tool] [Async] Removiendo bloqueo de cuenta con token de anulación...`);
        await new Promise(resolve => setTimeout(resolve, 200));
        externalDepositArrived = false;
        console.log(`[Tool] [Async] Bloqueo removido.`);
        return { externalBlocker: false };
    }
};

// 4. Herramienta para aprobar la factura de desembolso
const ApproveInvoice: ToolDefinition<LedgerState> = {
    id: "ApproveInvoice",
    preconditions: {
        balance: { $gte: 100 },
        invoiceApproved: false,
        externalBlocker: false // Requiere que la cuenta no esté bloqueada
    },
    effects: {
        invoiceApproved: true
    },
    execute: async (state) => {
        console.log(`[Tool] [Async] Aprobando factura. Balance actual (${state.balance}) es suficiente.`);
        await new Promise(resolve => setTimeout(resolve, 300));
        console.log(`[Tool] [Async] Factura aprobada.`);
        return { invoiceApproved: true };
    }
};

// 5. Herramienta para realizar la transferencia de fondos
const DisburseFunds: ToolDefinition<LedgerState> = {
    id: "DisburseFunds",
    preconditions: {
        invoiceApproved: true,
        fundsDisbursed: false
    },
    effects: {
        fundsDisbursed: true,
        balance: { $sub: 100 }
    },
    execute: async (state) => {
        console.log(`[Tool] [Async] Transfiriendo fondos (${state.balance})...`);
        await new Promise(resolve => setTimeout(resolve, 400));
        console.log(`[Tool] [Async] Desembolso procesado.`);
        return { fundsDisbursed: true, balance: state.balance - 100 };
    }
};

// 6. Herramienta para enviar informe de conciliación
const SendReconciliationReport: ToolDefinition<LedgerState> = {
    id: "SendReconciliationReport",
    preconditions: {
        fundsDisbursed: true,
        reconciliationReportSent: false
    },
    effects: {
        reconciliationReportSent: true
    },
    execute: async (state) => {
        console.log(`[Tool] [Async] Enviando informe de conciliación al banco central...`);
        await new Promise(resolve => setTimeout(resolve, 300));
        console.log(`[Tool] [Async] Informe enviado.`);
        return { reconciliationReportSent: true };
    }
};

// Definición de sensor dinámico
const BlockerSensor: SensorDefinition<LedgerState> = {
    id: "BlockerSensor",
    sense: async (state) => {
        if (externalDepositArrived) {
            console.log(`[Sensor] ¡Alerta! Se detectó un bloqueo externo de seguridad en la cuenta.`);
            return { externalBlocker: true };
        }
        return { externalBlocker: false };
    }
};

async function runLedgerWorkflow() {
    const tools = [
        SendReconciliationReport,
        ApproveInvoice,
        DepositCollateral,
        VerifyIdentity,
        ClearBlocker,
        InstantDeposit,
        DisburseFunds
    ];

    const initial: LedgerState = {
        balance: 50,
        invoiceApproved: false,
        fundsDisbursed: false,
        identityVerified: false,
        reconciliationReportSent: false,
        externalBlocker: false
    };

    const ledgerSchema: StateSchema<LedgerState> = {
        balance: { type: 'number', min: 0, required: true },
        invoiceApproved: { type: 'boolean', required: true },
        fundsDisbursed: { type: 'boolean', required: true },
        identityVerified: { type: 'boolean', required: true },
        reconciliationReportSent: { type: 'boolean', required: true },
        externalBlocker: { type: 'boolean', required: true }
    };

    const agent = new LatticeAgent<LedgerState>({
        initialState: initial,
        tools,
        goal: {
            reconciliationReportSent: true,
            identityVerified: true
        },
        cachePath: "./.ledger_cache.json",
        enableDevTools: true,
        sensors: [BlockerSensor],
        schema: ledgerSchema
    });

    try {
        console.log("=== EJECUCIÓN 1: PLANIFICACIÓN DE DAG PARALELO CON MONITOREO ===");
        const finalState = await agent.run();
        console.log("Estado Final 1:", finalState);

    } catch (error) {
        console.error("Error ejecutando el agente:", error);
    }
}

runLedgerWorkflow();