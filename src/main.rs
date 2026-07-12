use std::collections::HashMap;
use std::io::{self, Read, Write};
use std::net::TcpListener;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use lattice::tool::{SimpleTool, Condition, CompoundTask};
use lattice::skill_tree::SkillTree;
use lattice::planner::{LatticePlanner, SearchStep};

#[derive(Deserialize)]
struct PlanningRequest {
    initial_state: HashMap<String, Value>,
    goal: HashMap<String, Condition>,
    tools: Vec<SimpleTool>,
    cache_path: Option<String>,
    tasks: Option<Vec<String>>,
    compound_tasks: Option<Vec<CompoundTask>>,
}

#[derive(Serialize)]
struct PlanningResponse {
    success: bool,
    plan: Option<Vec<String>>,
    plan_tiers: Option<Vec<Vec<String>>>,
    telemetry: Option<Vec<SearchStep>>,
    error: Option<String>,
    from_cache: bool,
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let mut is_server = false;
    let mut port = 1999;

    for i in 0..args.len() {
        if args[i] == "--server" {
            is_server = true;
            if i + 1 < args.len() {
                if let Ok(parsed_port) = args[i + 1].parse::<u16>() {
                    port = parsed_port;
                }
            }
        }
    }

    if is_server {
        let addr = format!("127.0.0.1:{}", port);
        let listener = match TcpListener::bind(&addr) {
            Ok(l) => l,
            Err(e) => {
                eprintln!("Failed to bind to {}: {}", addr, e);
                std::process::exit(1);
            }
        };

        println!("LATTICE_SERVER_READY");
        std::io::stdout().flush().unwrap();

        for stream in listener.incoming() {
            let mut stream = match stream {
                Ok(s) => s,
                Err(_) => continue,
            };

            let mut buffer = String::new();
            if let Err(e) = stream.read_to_string(&mut buffer) {
                eprintln!("Failed to read stream: {}", e);
                continue;
            }

            let request: PlanningRequest = match serde_json::from_str(&buffer) {
                Ok(req) => req,
                Err(e) => {
                    let response = PlanningResponse {
                        success: false,
                        plan: None,
                        plan_tiers: None,
                        telemetry: None,
                        error: Some(format!("Invalid request JSON: {}", e)),
                        from_cache: false,
                    };
                    let _ = stream.write_all(serde_json::to_string(&response).unwrap().as_bytes());
                    continue;
                }
            };

            let cache_path = request.cache_path.clone().unwrap_or_else(|| ".lattice_cache.json".to_string());
            let skill_tree = match SkillTree::load_from_file(&cache_path) {
                Ok(st) => st,
                Err(e) => {
                    let response = PlanningResponse {
                        success: false,
                        plan: None,
                        plan_tiers: None,
                        telemetry: None,
                        error: Some(format!("Failed to load skill tree: {}", e)),
                        from_cache: false,
                    };
                    let _ = stream.write_all(serde_json::to_string(&response).unwrap().as_bytes());
                    continue;
                }
            };

            let is_htn = request.tasks.as_ref().map(|t| !t.is_empty()).unwrap_or(false);
            let mut from_cache = false;
            
            let plan_result = if !is_htn && skill_tree.get_plan(&request.initial_state, &request.goal).is_some() {
                from_cache = true;
                let cached_plan = skill_tree.get_plan(&request.initial_state, &request.goal).unwrap();
                Ok((cached_plan, Vec::new()))
            } else {
                let planner = LatticePlanner::new(skill_tree.clone());
                let tasks_ref = request.tasks.as_ref().map(|v| v.as_slice());
                let c_tasks_ref = request.compound_tasks.as_ref().map(|v| v.as_slice());
                planner.plan_hybrid(&request.initial_state, &request.goal, &request.tools, tasks_ref, c_tasks_ref)
            };

            match plan_result {
                Ok((plan, telemetry)) => {
                    let planner = LatticePlanner::new(skill_tree.clone());
                    let plan_tiers = planner.schedule_tiers(&plan, &request.tools);

                    if !from_cache && !is_htn {
                        skill_tree.cache_plan(&request.initial_state, &request.goal, plan.clone());
                        if let Err(e) = skill_tree.save_to_file(&cache_path) {
                            eprintln!("Warning: failed to save skill tree: {}", e);
                        }
                    }

                    let response = PlanningResponse {
                        success: true,
                        plan: Some(plan),
                        plan_tiers: Some(plan_tiers),
                        telemetry: Some(telemetry),
                        error: None,
                        from_cache,
                    };
                    let _ = stream.write_all(serde_json::to_string(&response).unwrap().as_bytes());
                }
                Err(e) => {
                    let response = PlanningResponse {
                        success: false,
                        plan: None,
                        plan_tiers: None,
                        telemetry: None,
                        error: Some(e),
                        from_cache: false,
                    };
                    let _ = stream.write_all(serde_json::to_string(&response).unwrap().as_bytes());
                }
            }
        }
    } else {
        let mut input = String::new();
        if let Err(e) = io::stdin().read_to_string(&mut input) {
            eprintln!("Failed to read stdin: {}", e);
            std::process::exit(1);
        }

        let request: PlanningRequest = match serde_json::from_str(&input) {
            Ok(req) => req,
            Err(e) => {
                let response = PlanningResponse {
                    success: false,
                    plan: None,
                    plan_tiers: None,
                    telemetry: None,
                    error: Some(format!("Invalid request JSON: {}", e)),
                    from_cache: false,
                };
                println!("{}", serde_json::to_string(&response).unwrap());
                return;
            }
        };

        let cache_path = request.cache_path.clone().unwrap_or_else(|| ".lattice_cache.json".to_string());
        let skill_tree = match SkillTree::load_from_file(&cache_path) {
            Ok(st) => st,
            Err(e) => {
                let response = PlanningResponse {
                    success: false,
                    plan: None,
                    plan_tiers: None,
                    telemetry: None,
                    error: Some(format!("Failed to load skill tree: {}", e)),
                    from_cache: false,
                };
                println!("{}", serde_json::to_string(&response).unwrap());
                return;
            }
        };

        let is_htn = request.tasks.as_ref().map(|t| !t.is_empty()).unwrap_or(false);
        let mut from_cache = false;
        
        let plan_result = if !is_htn && skill_tree.get_plan(&request.initial_state, &request.goal).is_some() {
            from_cache = true;
            let cached_plan = skill_tree.get_plan(&request.initial_state, &request.goal).unwrap();
            Ok((cached_plan, Vec::new()))
        } else {
            let planner = LatticePlanner::new(skill_tree.clone());
            let tasks_ref = request.tasks.as_ref().map(|v| v.as_slice());
            let c_tasks_ref = request.compound_tasks.as_ref().map(|v| v.as_slice());
            planner.plan_hybrid(&request.initial_state, &request.goal, &request.tools, tasks_ref, c_tasks_ref)
        };

        match plan_result {
            Ok((plan, telemetry)) => {
                let planner = LatticePlanner::new(skill_tree.clone());
                let plan_tiers = planner.schedule_tiers(&plan, &request.tools);

                if !from_cache && !is_htn {
                    skill_tree.cache_plan(&request.initial_state, &request.goal, plan.clone());
                    if let Err(e) = skill_tree.save_to_file(&cache_path) {
                        eprintln!("Warning: failed to save skill tree: {}", e);
                    }
                }

                let response = PlanningResponse {
                    success: true,
                    plan: Some(plan),
                    plan_tiers: Some(plan_tiers),
                    telemetry: Some(telemetry),
                    error: None,
                    from_cache,
                };
                println!("{}", serde_json::to_string(&response).unwrap());
            }
            Err(e) => {
                let response = PlanningResponse {
                    success: false,
                    plan: None,
                    plan_tiers: None,
                    telemetry: None,
                    error: Some(e),
                    from_cache: false,
                };
                println!("{}", serde_json::to_string(&response).unwrap());
            }
        }
    }
}
