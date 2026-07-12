use std::collections::HashMap;

#[derive(Debug, Clone, Default)]
pub struct Environment {
    pub properties: HashMap<String, String>,
}

impl Environment {
    pub fn new() -> Self {
        Self {
            properties: HashMap::new(),
        }
    }

    pub fn get(&self, key: &str) -> Option<&String> {
        self.properties.get(key)
    }

    pub fn set(&mut self, key: String, value: String) {
        self.properties.insert(key, value);
    }
}
