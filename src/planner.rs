use std::collections::{HashMap, HashSet, BinaryHeap};
use std::cmp::Ordering;
use serde::{Serialize, Deserialize};
use serde_json::Value;
use crate::tool::{Tool, Condition, Effect};
use crate::skill_tree::SkillTree;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SearchStep {
    pub state: HashMap<String, Value>,
    pub parent_state: Option<HashMap<String, Value>>,
    pub action: Option<String>,
    pub g: u32,
    pub h: u32,
    pub f: u32,
}

#[derive(Debug, Clone, Eq, PartialEq, Hash)]
struct PlannerState {
    canonical_json: String,
}

impl PlannerState {
    fn from_hashmap(map: &HashMap<String, Value>) -> Self {
        let mut keys: Vec<&String> = map.keys().collect();
        keys.sort();
        let sorted_kv: Vec<(&String, &Value)> = keys.iter().map(|&k| (k, map.get(k).unwrap())).collect();
        let canonical_json = serde_json::to_string(&sorted_kv).unwrap();
        Self { canonical_json }
    }

    fn to_hashmap(&self) -> HashMap<String, Value> {
        let sorted_kv: Vec<(String, Value)> = serde_json::from_str(&self.canonical_json).unwrap();
        sorted_kv.into_iter().collect()
    }
}

#[derive(Clone, Eq, PartialEq)]
struct Node {
    state: PlannerState,
    parent_state: Option<PlannerState>,
    parent_action: Option<String>,
    g_score: u32,
    f_score: u32,
    path: Vec<String>,
}

impl Ord for Node {
    fn cmp(&self, other: &Self) -> Ordering {
        other.f_score.cmp(&self.f_score)
            .then_with(|| self.g_score.cmp(&other.g_score))
    }
}

impl PartialOrd for Node {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

fn heuristic(state: &HashMap<String, Value>, goal: &HashMap<String, Condition>) -> u32 {
    let mut unsatisfied = 0;
    for (k, cond) in goal {
        if !cond.matches(state.get(k)) {
            unsatisfied += 1;
        }
    }
    unsatisfied
}

pub struct LatticePlanner {
    pub skill_tree: SkillTree,
}

impl LatticePlanner {
    pub fn new(skill_tree: SkillTree) -> Self {
        Self { skill_tree }
    }

    pub fn plan<T: Tool>(&self, current_state: &HashMap<String, Value>, goal: &HashMap<String, Condition>, tools: &[T]) -> Result<(Vec<String>, Vec<SearchStep>), String> {
        if let Some(cached_plan) = self.skill_tree.get_plan(current_state, goal) {
            return Ok((cached_plan, Vec::new()));
        }

        let mut telemetry = Vec::new();
        let start_state = PlannerState::from_hashmap(current_state);
        let mut open_set = BinaryHeap::new();
        let mut visited = HashSet::new();

        let h_start = heuristic(current_state, goal);
        open_set.push(Node {
            state: start_state.clone(),
            parent_state: None,
            parent_action: None,
            g_score: 0,
            f_score: h_start,
            path: Vec::new(),
        });

        while let Some(Node { state, parent_state, parent_action, g_score, f_score, path }) = open_set.pop() {
            let state_map = state.to_hashmap();

            let h_val = f_score.saturating_sub(g_score);
            telemetry.push(SearchStep {
                state: state_map.clone(),
                parent_state: parent_state.as_ref().map(|p| p.to_hashmap()),
                action: parent_action.clone(),
                g: g_score,
                h: h_val,
                f: f_score,
            });

            if self.is_goal_met(&state_map, goal) {
                self.skill_tree.cache_plan(current_state, goal, path.clone());
                return Ok((path, telemetry));
            }

            if visited.contains(&state) {
                continue;
            }
            visited.insert(state.clone());

            for tool in tools {
                if self.can_apply(&state_map, tool.preconditions()) {
                    let mut next_state_map = state_map.clone();
                    for (k, effect) in tool.effects() {
                        let current_val = next_state_map.get(k);
                        let new_val = effect.apply(current_val);
                        next_state_map.insert(k.clone(), new_val);
                    }

                    let next_state = PlannerState::from_hashmap(&next_state_map);
                    if !visited.contains(&next_state) {
                        let next_g = g_score + tool.cost();
                        let next_h = heuristic(&next_state_map, goal);
                        let mut next_path = path.clone();
                        next_path.push(tool.id().to_string());

                        open_set.push(Node {
                            state: next_state,
                            parent_state: Some(state.clone()),
                            parent_action: Some(tool.id().to_string()),
                            g_score: next_g,
                            f_score: next_g + next_h,
                            path: next_path,
                        });
                    }
                }
            }
        }

        Err("No planning path found to satisfy the goal".to_string())
    }

    pub fn schedule_tiers<T: Tool>(&self, plan: &[String], tools: &[T]) -> Vec<Vec<String>> {
        let mut levels = vec![0; plan.len()];

        for i in 1..plan.len() {
            let tool_y = tools.iter().find(|t| t.id() == &plan[i]).unwrap();
            let y_pre: HashSet<&String> = tool_y.preconditions().keys().collect();
            let y_eff: HashSet<&String> = tool_y.effects().keys().collect();

            for j in 0..i {
                let tool_x = tools.iter().find(|t| t.id() == &plan[j]).unwrap();
                let x_pre: HashSet<&String> = tool_x.preconditions().keys().collect();
                let x_eff: HashSet<&String> = tool_x.effects().keys().collect();

                let raw = x_eff.iter().any(|k| y_pre.contains(k));
                let waw = x_eff.iter().any(|k| y_eff.contains(k));
                let war = x_pre.iter().any(|k| y_eff.contains(k));

                if raw || waw || war {
                    levels[i] = std::cmp::max(levels[i], levels[j] + 1);
                }
            }
        }

        let max_level = levels.iter().max().cloned().unwrap_or(0);
        let mut tiers = vec![Vec::new(); max_level + 1];
        for (idx, &lvl) in levels.iter().enumerate() {
            tiers[lvl].push(plan[idx].clone());
        }

        tiers.into_iter().filter(|t| !t.is_empty()).collect()
    }

    fn can_apply(&self, state: &HashMap<String, Value>, preconditions: &HashMap<String, Condition>) -> bool {
        preconditions.iter().all(|(k, cond)| cond.matches(state.get(k)))
    }

    fn is_goal_met(&self, state: &HashMap<String, Value>, goal: &HashMap<String, Condition>) -> bool {
        goal.iter().all(|(k, cond)| cond.matches(state.get(k)))
    }

    pub fn plan_hybrid<T: Tool>(
        &self,
        current_state: &HashMap<String, Value>,
        goal: &HashMap<String, Condition>,
        tools: &[T],
        tasks: Option<&[String]>,
        compound_tasks: Option<&[crate::tool::CompoundTask]>
    ) -> Result<(Vec<String>, Vec<SearchStep>), String> {
        if let Some(t_list) = tasks {
            if !t_list.is_empty() {
                let mut plan = Vec::new();
                let mut telemetry = Vec::new();
                let c_tasks = compound_tasks.unwrap_or(&[]);

                telemetry.push(SearchStep {
                    state: current_state.clone(),
                    parent_state: None,
                    action: None,
                    g: 0,
                    h: 0,
                    f: 0,
                });

                match self.plan_htn(current_state, t_list, tools, c_tasks, &mut plan, &mut telemetry) {
                    Ok(_) => return Ok((plan, telemetry)),
                    Err(e) => return Err(format!("HTN Planning failed: {}", e)),
                }
            }
        }

        self.plan(current_state, goal, tools)
    }

    fn plan_htn<T: Tool>(
        &self,
        current_state: &HashMap<String, Value>,
        tasks: &[String],
        tools: &[T],
        compound_tasks: &[crate::tool::CompoundTask],
        plan: &mut Vec<String>,
        telemetry: &mut Vec<SearchStep>
    ) -> Result<HashMap<String, Value>, String> {
        if tasks.is_empty() {
            return Ok(current_state.clone());
        }

        let first_task_id = &tasks[0];
        let remaining_tasks = &tasks[1..];

        if let Some(tool) = tools.iter().find(|t| t.id() == first_task_id) {
            if self.can_apply(current_state, tool.preconditions()) {
                let mut next_state = current_state.clone();
                for (k, effect) in tool.effects() {
                    let current_val = next_state.get(k);
                    let new_val = effect.apply(current_val);
                    next_state.insert(k.clone(), new_val);
                }

                let current_cost = plan.iter()
                    .map(|id| tools.iter().find(|t| t.id() == id).map(|t| t.cost()).unwrap_or(1))
                    .sum::<u32>() + tool.cost();

                telemetry.push(SearchStep {
                    state: next_state.clone(),
                    parent_state: Some(current_state.clone()),
                    action: Some(tool.id().to_string()),
                    g: current_cost,
                    h: 0,
                    f: current_cost,
                });

                plan.push(tool.id().to_string());

                match self.plan_htn(&next_state, remaining_tasks, tools, compound_tasks, plan, telemetry) {
                    Ok(final_state) => return Ok(final_state),
                    Err(_) => {
                        plan.pop();
                        telemetry.pop();
                    }
                }
            }
            return Err(format!("Preconditions not met for primitive task: {}", first_task_id));
        }

        if let Some(compound) = compound_tasks.iter().find(|c| &c.id == first_task_id) {
            for method in &compound.methods {
                if self.can_apply(current_state, &method.preconditions) {
                    let mut new_tasks = method.sub_tasks.clone();
                    new_tasks.extend_from_slice(remaining_tasks);

                    match self.plan_htn(current_state, &new_tasks, tools, compound_tasks, plan, telemetry) {
                        Ok(final_state) => return Ok(final_state),
                        Err(_) => {
                            continue;
                        }
                    }
                }
            }
            return Err(format!("No applicable method found for compound task: {}", first_task_id));
        }

        Err(format!("Task not defined: {}", first_task_id))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tool::SimpleTool;

    #[test]
    fn test_astar_planning() {
        let skill_tree = SkillTree::new();
        let planner = LatticePlanner::new(skill_tree);

        let mut initial_state = HashMap::new();
        initial_state.insert("a".to_string(), Value::Bool(false));
        initial_state.insert("b".to_string(), Value::Bool(false));

        let mut goal = HashMap::new();
        goal.insert("b".to_string(), Condition::Value(Value::Bool(true)));

        let tools = vec![
            SimpleTool {
                id: "tool1".to_string(),
                preconditions: {
                    let mut m = HashMap::new();
                    m.insert("a".to_string(), Condition::Value(Value::Bool(false)));
                    m
                },
                effects: {
                    let mut m = HashMap::new();
                    m.insert("a".to_string(), Effect::Value(Value::Bool(true)));
                    m
                },
                cost: None,
            },
            SimpleTool {
                id: "tool2".to_string(),
                preconditions: {
                    let mut m = HashMap::new();
                    m.insert("a".to_string(), Condition::Value(Value::Bool(true)));
                    m.insert("b".to_string(), Condition::Value(Value::Bool(false)));
                    m
                },
                effects: {
                    let mut m = HashMap::new();
                    m.insert("b".to_string(), Effect::Value(Value::Bool(true)));
                    m
                },
                cost: None,
            },
        ];

        let (plan, telemetry) = planner.plan(&initial_state, &goal, &tools).unwrap();
        assert_eq!(plan, vec!["tool1".to_string(), "tool2".to_string()]);
        assert!(telemetry.len() > 0);
    }

    #[test]
    fn test_astar_loop_threshold() {
        let skill_tree = SkillTree::new();
        let planner = LatticePlanner::new(skill_tree);

        let mut initial_state = HashMap::new();
        initial_state.insert("counter".to_string(), Value::Number(serde_json::Number::from(0)));

        let mut goal = HashMap::new();
        goal.insert("counter".to_string(), Condition::Value(Value::Number(serde_json::Number::from(2))));

        let tools = vec![
            SimpleTool {
                id: "increment".to_string(),
                preconditions: {
                    let mut m = HashMap::new();
                    let mut ops = HashMap::new();
                    ops.insert("$lt".to_string(), Value::Number(serde_json::Number::from(2)));
                    m.insert("counter".to_string(), Condition::Operators(ops));
                    m
                },
                effects: {
                    let mut m = HashMap::new();
                    let mut ops = HashMap::new();
                    ops.insert("$add".to_string(), Value::Number(serde_json::Number::from(1)));
                    m.insert("counter".to_string(), Effect::Mutator(ops));
                    m
                },
                cost: None,
            },
        ];

        let (plan, telemetry) = planner.plan(&initial_state, &goal, &tools).unwrap();
        assert_eq!(plan, vec!["increment".to_string(), "increment".to_string()]);
        assert!(telemetry.len() > 0);
    }

    #[test]
    fn test_ledger_workflow() {
        let skill_tree = SkillTree::new();
        let planner = LatticePlanner::new(skill_tree);

        let mut initial_state = HashMap::new();
        initial_state.insert("balance".to_string(), Value::Number(serde_json::Number::from(50)));
        initial_state.insert("invoiceApproved".to_string(), Value::Bool(false));
        initial_state.insert("fundsDisbursed".to_string(), Value::Bool(false));
        initial_state.insert("reconciliationReportSent".to_string(), Value::Bool(false));

        let mut goal = HashMap::new();
        goal.insert("reconciliationReportSent".to_string(), Condition::Value(Value::Bool(true)));

        let tools = vec![
            SimpleTool {
                id: "SendReconciliationReport".to_string(),
                preconditions: {
                    let mut m = HashMap::new();
                    m.insert("fundsDisbursed".to_string(), Condition::Value(Value::Bool(true)));
                    m.insert("reconciliationReportSent".to_string(), Condition::Value(Value::Bool(false)));
                    m
                },
                effects: {
                    let mut m = HashMap::new();
                    m.insert("reconciliationReportSent".to_string(), Effect::Value(Value::Bool(true)));
                    m
                },
                cost: None,
            },
            SimpleTool {
                id: "ApproveInvoice".to_string(),
                preconditions: {
                    let mut m = HashMap::new();
                    let mut ops = HashMap::new();
                    ops.insert("$gte".to_string(), Value::Number(serde_json::Number::from(100)));
                    m.insert("balance".to_string(), Condition::Operators(ops));
                    m.insert("invoiceApproved".to_string(), Condition::Value(Value::Bool(false)));
                    m
                },
                effects: {
                    let mut m = HashMap::new();
                    m.insert("invoiceApproved".to_string(), Effect::Value(Value::Bool(true)));
                    m
                },
                cost: None,
            },
            SimpleTool {
                id: "DepositCollateral".to_string(),
                preconditions: {
                    let mut m = HashMap::new();
                    let mut ops = HashMap::new();
                    ops.insert("$lt".to_string(), Value::Number(serde_json::Number::from(100)));
                    m.insert("balance".to_string(), Condition::Operators(ops));
                    m
                },
                effects: {
                    let mut m = HashMap::new();
                    let mut ops = HashMap::new();
                    ops.insert("$add".to_string(), Value::Number(serde_json::Number::from(50)));
                    m.insert("balance".to_string(), Effect::Mutator(ops));
                    m
                },
                cost: None,
            },
            SimpleTool {
                id: "DisburseFunds".to_string(),
                preconditions: {
                    let mut m = HashMap::new();
                    m.insert("invoiceApproved".to_string(), Condition::Value(Value::Bool(true)));
                    m.insert("fundsDisbursed".to_string(), Condition::Value(Value::Bool(false)));
                    m
                },
                effects: {
                    let mut m = HashMap::new();
                    m.insert("fundsDisbursed".to_string(), Effect::Value(Value::Bool(true)));
                    let mut ops = HashMap::new();
                    ops.insert("$sub".to_string(), Value::Number(serde_json::Number::from(100)));
                    m.insert("balance".to_string(), Effect::Mutator(ops));
                    m
                },
                cost: None,
            },
        ];

        let (plan, telemetry) = planner.plan(&initial_state, &goal, &tools).unwrap();
        assert_eq!(plan, vec![
            "DepositCollateral".to_string(),
            "ApproveInvoice".to_string(),
            "DisburseFunds".to_string(),
            "SendReconciliationReport".to_string()
        ]);
        assert!(telemetry.len() > 0);
    }

    #[test]
    fn test_parallel_scheduling() {
        let skill_tree = SkillTree::new();
        let planner = LatticePlanner::new(skill_tree);

        let tools = vec![
            SimpleTool {
                id: "tool1".to_string(),
                preconditions: {
                    let mut m = HashMap::new();
                    m.insert("a".to_string(), Condition::Value(Value::Bool(false)));
                    m
                },
                effects: {
                    let mut m = HashMap::new();
                    m.insert("a".to_string(), Effect::Value(Value::Bool(true)));
                    m
                },
                cost: None,
            },
            SimpleTool {
                id: "tool2".to_string(),
                preconditions: {
                    let mut m = HashMap::new();
                    m.insert("b".to_string(), Condition::Value(Value::Bool(false)));
                    m
                },
                effects: {
                    let mut m = HashMap::new();
                    m.insert("b".to_string(), Effect::Value(Value::Bool(true)));
                    m
                },
                cost: None,
            },
            SimpleTool {
                id: "tool3".to_string(),
                preconditions: {
                    let mut m = HashMap::new();
                    m.insert("a".to_string(), Condition::Value(Value::Bool(true)));
                    m.insert("b".to_string(), Condition::Value(Value::Bool(true)));
                    m
                },
                effects: {
                    let mut m = HashMap::new();
                    m.insert("c".to_string(), Effect::Value(Value::Bool(true)));
                    m
                },
                cost: None,
            },
        ];

        let plan = vec!["tool1".to_string(), "tool2".to_string(), "tool3".to_string()];
        let tiers = planner.schedule_tiers(&plan, &tools);

        assert_eq!(tiers.len(), 2);
        assert!(tiers[0].contains(&"tool1".to_string()));
        assert!(tiers[0].contains(&"tool2".to_string()));
        assert_eq!(tiers[1], vec!["tool3".to_string()]);
    }

    #[test]
    fn test_htn_planning() {
        use crate::tool::CompoundTask;
        use crate::tool::Method;

        let skill_tree = SkillTree::new();
        let planner = LatticePlanner::new(skill_tree);

        let mut initial_state = HashMap::new();
        initial_state.insert("has_foundation".to_string(), Value::Bool(false));
        initial_state.insert("has_walls".to_string(), Value::Bool(false));

        let tools = vec![
            SimpleTool {
                id: "BuildFoundation".to_string(),
                preconditions: {
                    let mut m = HashMap::new();
                    m.insert("has_foundation".to_string(), Condition::Value(Value::Bool(false)));
                    m
                },
                effects: {
                    let mut m = HashMap::new();
                    m.insert("has_foundation".to_string(), Effect::Value(Value::Bool(true)));
                    m
                },
                cost: None,
            },
            SimpleTool {
                id: "BuildWalls".to_string(),
                preconditions: {
                    let mut m = HashMap::new();
                    m.insert("has_foundation".to_string(), Condition::Value(Value::Bool(true)));
                    m.insert("has_walls".to_string(), Condition::Value(Value::Bool(false)));
                    m
                },
                effects: {
                    let mut m = HashMap::new();
                    m.insert("has_walls".to_string(), Effect::Value(Value::Bool(true)));
                    m
                },
                cost: None,
            },
        ];

        let compound_tasks = vec![
            CompoundTask {
                id: "BuildHouse".to_string(),
                methods: vec![
                    Method {
                        preconditions: HashMap::new(),
                        sub_tasks: vec!["BuildFoundation".to_string(), "BuildWalls".to_string()],
                    }
                ],
            }
        ];

        let tasks = vec!["BuildHouse".to_string()];
        let goal = HashMap::new();

        let (plan, telemetry) = planner.plan_hybrid(&initial_state, &goal, &tools, Some(&tasks), Some(&compound_tasks)).unwrap();
        assert_eq!(plan, vec!["BuildFoundation".to_string(), "BuildWalls".to_string()]);
        assert_eq!(telemetry.len(), 3);
    }
}
