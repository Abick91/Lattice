use std::collections::HashMap;
use crate::memory::WorkingMemory;
use crate::environment::Environment;
use serde::{Serialize, Deserialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum Condition {
    Operators(HashMap<String, Value>),
    Value(Value),
}

fn compare_values<F>(actual: &Value, expected: &Value, op: F) -> bool
where
    F: Fn(f64, f64) -> bool,
{
    match (actual, expected) {
        (Value::Number(a), Value::Number(b)) => {
            if let (Some(af), Some(bf)) = (a.as_f64(), b.as_f64()) {
                op(af, bf)
            } else {
                false
            }
        }
        _ => false,
    }
}

impl Condition {
    pub fn matches(&self, actual_val: Option<&Value>) -> bool {
        match self {
            Condition::Value(expected_val) => {
                match (expected_val, actual_val) {
                    (Value::Null, None) => true,
                    (Value::Null, Some(Value::Null)) => true,
                    (_, None) => false,
                    (exp, Some(act)) => {
                        if let (Value::Number(e_num), Value::Number(a_num)) = (exp, act) {
                            e_num.as_f64() == a_num.as_f64()
                        } else {
                            exp == act
                        }
                    }
                }
            }
            Condition::Operators(ops) => {
                for (op, expected_val) in ops {
                    let actual_val = actual_val.unwrap_or(&Value::Null);
                    match op.as_str() {
                        "$eq" => {
                            match (actual_val, expected_val) {
                                (Value::Number(a), Value::Number(e)) => {
                                    if a.as_f64() != e.as_f64() { return false; }
                                }
                                _ => {
                                    if actual_val != expected_val { return false; }
                                }
                            }
                        }
                        "$ne" => {
                            match (actual_val, expected_val) {
                                (Value::Number(a), Value::Number(e)) => {
                                    if a.as_f64() == e.as_f64() { return false; }
                                }
                                _ => {
                                    if actual_val == expected_val { return false; }
                                }
                            }
                        }
                        "$gt" => {
                            if !compare_values(actual_val, expected_val, |a, b| a > b) { return false; }
                        }
                        "$gte" => {
                            if !compare_values(actual_val, expected_val, |a, b| a >= b) { return false; }
                        }
                        "$lt" => {
                            if !compare_values(actual_val, expected_val, |a, b| a < b) { return false; }
                        }
                        "$lte" => {
                            if !compare_values(actual_val, expected_val, |a, b| a <= b) { return false; }
                        }
                        _ => return false,
                    }
                }
                true
            }
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum Effect {
    Mutator(HashMap<String, Value>),
    Value(Value),
}

impl Effect {
    pub fn apply(&self, current_val: Option<&Value>) -> Value {
        match self {
            Effect::Value(val) => val.clone(),
            Effect::Mutator(ops) => {
                let mut val = current_val.cloned().unwrap_or(Value::Number(serde_json::Number::from(0)));
                for (op, arg) in ops {
                    match op.as_str() {
                        "$set" => {
                            val = arg.clone();
                        }
                        "$add" => {
                            if let (Value::Number(n), Value::Number(b)) = (&mut val, arg) {
                                if let (Some(nf), Some(bf)) = (n.as_f64(), b.as_f64()) {
                                    if let Some(new_num) = serde_json::Number::from_f64(nf + bf) {
                                        val = Value::Number(new_num);
                                    }
                                }
                            }
                        }
                        "$sub" => {
                            if let (Value::Number(n), Value::Number(b)) = (&mut val, arg) {
                                if let (Some(nf), Some(bf)) = (n.as_f64(), b.as_f64()) {
                                    if let Some(new_num) = serde_json::Number::from_f64(nf - bf) {
                                        val = Value::Number(new_num);
                                    }
                                }
                            }
                        }
                        _ => {}
                    }
                }
                val
            }
        }
    }
}

pub trait Tool: Send + Sync {
    fn id(&self) -> &str;
    fn preconditions(&self) -> &HashMap<String, Condition>;
    fn effects(&self) -> &HashMap<String, Effect>;
    fn execute(&self, memory: &mut WorkingMemory, env: &mut Environment) -> Result<(), String>;
    fn cost(&self) -> u32 { 1 }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimpleTool {
    pub id: String,
    pub preconditions: HashMap<String, Condition>,
    pub effects: HashMap<String, Effect>,
    pub cost: Option<u32>,
}

impl Tool for SimpleTool {
    fn id(&self) -> &str {
        &self.id
    }

    fn preconditions(&self) -> &HashMap<String, Condition> {
        &self.preconditions
    }

    fn effects(&self) -> &HashMap<String, Effect> {
        &self.effects
    }

    fn execute(&self, memory: &mut WorkingMemory, _env: &mut Environment) -> Result<(), String> {
        memory.apply_effects(&self.effects);
        Ok(())
    }

    fn cost(&self) -> u32 {
        self.cost.unwrap_or(1)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Method {
    pub preconditions: HashMap<String, Condition>,
    pub sub_tasks: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompoundTask {
    pub id: String,
    pub methods: Vec<Method>,
}
