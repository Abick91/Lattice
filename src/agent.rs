use std::collections::HashMap;
use serde_json::Value;
use crate::memory::WorkingMemory;
use crate::environment::Environment;
use crate::planner::LatticePlanner;
use crate::tool::{Tool, Condition};

pub struct Agent {
    pub memory: WorkingMemory,
    pub environment: Environment,
    pub planner: LatticePlanner,
}

impl Agent {
    pub fn new(initial_state: HashMap<String, Value>, environment: Environment, planner: LatticePlanner) -> Self {
        Self {
            memory: WorkingMemory::from_state(initial_state),
            environment,
            planner,
        }
    }

    pub fn percept(&mut self, keys: &[&str]) {
        for key in keys {
            if let Some(val) = self.environment.get(key) {
                let parsed_val = serde_json::from_str(val).unwrap_or_else(|_| Value::String(val.clone()));
                self.memory.set(key.to_string(), parsed_val);
            }
        }
    }

    pub fn plan<T: Tool>(&self, goal: &HashMap<String, Condition>, tools: &[T]) -> Result<Vec<String>, String> {
        self.planner.plan(&self.memory.state, goal, tools).map(|(plan, _)| plan)
    }

    pub fn execute<T: Tool>(&mut self, plan: &[String], tools: &[T]) -> Result<(), String> {
        for tool_id in plan {
            let tool = tools.iter()
                .find(|t| t.id() == tool_id)
                .ok_or_else(|| format!("Tool not found: {}", tool_id))?;
            
            if !self.memory.satisfies(tool.preconditions()) {
                return Err(format!("Preconditions not met for tool: {}", tool_id));
            }

            tool.execute(&mut self.memory, &mut self.environment)?;
        }
        Ok(())
    }

    pub fn run<T: Tool>(&mut self, goal: &HashMap<String, Condition>, tools: &[T], percept_keys: &[&str]) -> Result<Vec<String>, String> {
        self.percept(percept_keys);
        let plan = self.plan(goal, tools)?;
        self.execute(&plan, tools)?;
        Ok(plan)
    }
}
