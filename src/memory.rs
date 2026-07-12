use std::collections::HashMap;
use serde::{Serialize, Deserialize};
use serde_json::Value;
use crate::tool::{Condition, Effect};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct WorkingMemory {
    pub state: HashMap<String, Value>,
}

impl WorkingMemory {
    pub fn new() -> Self {
        Self {
            state: HashMap::new(),
        }
    }

    pub fn from_state(state: HashMap<String, Value>) -> Self {
        Self { state }
    }

    pub fn get(&self, key: &str) -> Option<&Value> {
        self.state.get(key)
    }

    pub fn set(&mut self, key: String, value: Value) {
        self.state.insert(key, value);
    }

    pub fn satisfies(&self, preconditions: &HashMap<String, Condition>) -> bool {
        preconditions.iter().all(|(k, cond)| cond.matches(self.state.get(k)))
    }

    pub fn apply_effects(&mut self, effects: &HashMap<String, Effect>) {
        for (k, effect) in effects {
            let current_val = self.state.get(k);
            let new_val = effect.apply(current_val);
            self.state.insert(k.clone(), new_val);
        }
    }
}
