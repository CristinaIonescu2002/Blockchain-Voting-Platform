# Smart Contract Benchmarking

The benchmark focus is the smart contract layer, because this is the component
responsible for enforcing voting rules and recording the trusted voting state.

Run the voting flow scenario from the smart contract folder:

```powershell
cd smart-contracts/association-manager
cargo test voting_flow_rs -- --nocapture
```

The scenario covers:

- contract deployment
- association creation
- voting session creation
- valid votes
- duplicate vote rejection
- session finalization

For the report, collect the gas used by the main operations and compare it
across small, medium, and larger local voting scenarios.
