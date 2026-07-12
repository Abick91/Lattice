use std::collections::HashMap;
use std::alloc::{alloc as rust_alloc, dealloc as rust_dealloc, Layout};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::tool::{SimpleTool, Condition, CompoundTask};
use crate::skill_tree::SkillTree;
use crate::planner::{LatticePlanner, SearchStep};

#[derive(Deserialize)]
struct PlanningRequest {
    initial_state: HashMap<String, Value>,
    goal: HashMap<String, Condition>,
    tools: Vec<SimpleTool>,
    cache_data: Option<HashMap<u64, Vec<String>>>,
    tasks: Option<Vec<String>>,
    compound_tasks: Option<Vec<CompoundTask>>,
}

#[derive(Serialize)]
struct PlanningResponse {
    success: bool,
    plan: Option<Vec<String>>,
    plan_tiers: Option<Vec<Vec<String>>>,
    telemetry: Option<Vec<SearchStep>>,
    cache_data: Option<HashMap<u64, Vec<String>>>,
    error: Option<String>,
    from_cache: bool,
}

fn return_serialized_bytes(json_str: String) -> *mut u8 {
    let mut bytes = json_str.into_bytes();
    bytes.push(0); // Null terminator
    
    let size = bytes.len();
    let layout = Layout::from_size_align(size, 8).unwrap();
    unsafe {
        let ptr = rust_alloc(layout);
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr, size);
        ptr
    }
}

fn serialize_error(msg: String) -> *mut u8 {
    let response = PlanningResponse {
        success: false,
        plan: None,
        plan_tiers: None,
        telemetry: None,
        cache_data: None,
        error: Some(msg),
        from_cache: false,
    };
    return_serialized_bytes(serde_json::to_string(&response).unwrap())
}

#[unsafe(no_mangle)]
pub extern "C" fn alloc(size: usize) -> *mut u8 {
    let layout = Layout::from_size_align(size, 8).unwrap();
    unsafe { rust_alloc(layout) }
}

#[unsafe(no_mangle)]
pub extern "C" fn dealloc(ptr: *mut u8, size: usize) {
    let layout = Layout::from_size_align(size, 8).unwrap();
    unsafe { rust_dealloc(ptr, layout) }
}

#[unsafe(no_mangle)]
pub extern "C" fn plan_wasm(ptr: *mut u8, len: usize) -> *mut u8 {
    let input_bytes = unsafe { std::slice::from_raw_parts(ptr, len) };
    let input_str = match std::str::from_utf8(input_bytes) {
        Ok(s) => s,
        Err(e) => return serialize_error(format!("Invalid UTF-8 request: {}", e)),
    };

    let request: PlanningRequest = match serde_json::from_str(input_str) {
        Ok(req) => req,
        Err(e) => return serialize_error(format!("Invalid request JSON: {}", e)),
    };

    let skill_tree = SkillTree::new();
    if let Some(cache_map) = request.cache_data {
        skill_tree.set_cache_data(cache_map);
    }

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
            }

            let updated_cache = if !from_cache && !is_htn {
                Some(skill_tree.get_cache_data())
            } else {
                None
            };

            let response = PlanningResponse {
                success: true,
                plan: Some(plan),
                plan_tiers: Some(plan_tiers),
                telemetry: Some(telemetry),
                cache_data: updated_cache,
                error: None,
                from_cache,
            };
            return_serialized_bytes(serde_json::to_string(&response).unwrap())
        }
        Err(e) => {
            let response = PlanningResponse {
                success: false,
                plan: None,
                plan_tiers: None,
                telemetry: None,
                cache_data: None,
                error: Some(e),
                from_cache: false,
            };
            return_serialized_bytes(serde_json::to_string(&response).unwrap())
        }
    }
}
