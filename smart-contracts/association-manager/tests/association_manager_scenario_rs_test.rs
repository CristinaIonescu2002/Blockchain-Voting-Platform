use multiversx_sc_scenario::imports::*;

fn world() -> ScenarioWorld {
    let mut blockchain = ScenarioWorld::new();

    // blockchain.set_current_dir_from_workspace("relative path to your workspace, if applicable");
    blockchain.register_contract("mxsc:output/association-manager.mxsc.json", association_manager::ContractBuilder);
    blockchain
}

#[test]
fn empty_rs() {
    world().run("scenarios/association_manager.scen.json");
}

#[test]
fn direct_voting_flow_small_rs() {
    world().run("scenarios/direct_voting_flow_small.scen.json");
}

#[test]
fn direct_voting_flow_rs() {
    world().run("scenarios/direct_voting_flow_small.scen.json");
}

#[test]
fn direct_voting_flow_medium_rs() {
    world().run("scenarios/direct_voting_flow_medium.scen.json");
}

#[test]
fn direct_voting_flow_large_rs() {
    world().run("scenarios/direct_voting_flow_large.scen.json");
}

#[test]
fn fault_cases_rs() {
    world().run("scenarios/fault_cases.scen.json");
}

#[test]
fn multi_choice_vote_rs() {
    world().run("scenarios/multi_choice_vote.scen.json");
}

#[test]
fn no_quorum_finalize_rs() {
    world().run("scenarios/no_quorum_finalize.scen.json");
}
