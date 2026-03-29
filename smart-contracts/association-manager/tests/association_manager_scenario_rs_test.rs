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
