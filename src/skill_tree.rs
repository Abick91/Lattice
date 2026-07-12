use std::collections::HashMap;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::sync::{Arc, RwLock};
use serde_json::Value;
use crate::tool::Condition;

#[derive(Debug, Clone)]
pub struct SkillTree {
    cache: Arc<RwLock<HashMap<u64, Vec<String>>>>,
}

impl SkillTree {
    pub fn new() -> Self {
        Self {
            cache: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub fn compute_hash(&self, state: &HashMap<String, Value>, goal: &HashMap<String, Condition>) -> u64 {
        let mut hasher = DefaultHasher::new();
        
        let mut state_keys: Vec<&String> = state.keys().collect();
        state_keys.sort();
        for k in state_keys {
            k.hash(&mut hasher);
            let val_str = serde_json::to_string(state.get(k).unwrap()).unwrap();
            val_str.hash(&mut hasher);
        }

        let mut goal_keys: Vec<&String> = goal.keys().collect();
        goal_keys.sort();
        for k in goal_keys {
            k.hash(&mut hasher);
            let cond_str = serde_json::to_string(goal.get(k).unwrap()).unwrap();
            cond_str.hash(&mut hasher);
        }

        hasher.finish()
    }

    pub fn get_plan(&self, state: &HashMap<String, Value>, goal: &HashMap<String, Condition>) -> Option<Vec<String>> {
        let hash = self.compute_hash(state, goal);
        let cache = self.cache.read().unwrap();
        cache.get(&hash).cloned()
    }

    pub fn cache_plan(&self, state: &HashMap<String, Value>, goal: &HashMap<String, Condition>, plan: Vec<String>) {
        let hash = self.compute_hash(state, goal);
        let mut cache = self.cache.write().unwrap();
        cache.insert(hash, plan);
    }

    pub fn get_cache_data(&self) -> HashMap<u64, Vec<String>> {
        self.cache.read().unwrap().clone()
    }

    pub fn set_cache_data(&self, data: HashMap<u64, Vec<String>>) {
        *self.cache.write().unwrap() = data;
    }

    pub fn load_from_file(path: &str) -> Result<Self, String> {
        if std::path::Path::new(path).exists() {
            let content = std::fs::read_to_string(path)
                .map_err(|e| format!("Failed to read cache file: {}", e))?;
            let map: HashMap<u64, Vec<String>> = serde_json::from_str(&content)
                .map_err(|e| format!("Failed to parse cache file: {}", e))?;
            Ok(Self {
                cache: Arc::new(RwLock::new(map)),
            })
        } else {
            Ok(Self::new())
        }
    }

    pub fn save_to_file(&self, path: &str) -> Result<(), String> {
        let cache = self.cache.read().unwrap();
        let content = serde_json::to_string(&*cache)
            .map_err(|e| format!("Failed to serialize cache: {}", e))?;
        std::fs::write(path, content)
            .map_err(|e| format!("Failed to write cache file: {}", e))?;
        Ok(())
    }
}
