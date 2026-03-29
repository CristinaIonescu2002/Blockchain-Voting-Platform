WALLET_PEM="./../deployer.pem"
PROXY="https://devnet-gateway.multiversx.com"
WASM_PATH="./output/association-manager.wasm"
CHAIN="D"

# dupa deploy, seteaza asta (manual sau din deploy.json)
SC_ADDRESS="erd1qqqqqqqqqqqqqpgqfuxy2dg9r3hsp2epyx78w4g09xlh8qzx086qgwepdv"

# deploy
deploySC() {
    mxpy contract deploy \
    --bytecode=${WASM_PATH} \
    --pem=${WALLET_PEM} \
    --gas-limit 60000000 \
    --proxy=${PROXY} \
    --chain ${CHAIN} \
    --send
}
# upgrade
upgradeSC() {
    mxpy contract upgrade ${SC_ADDRESS} \
    --bytecode=${WASM_PATH} \
    --pem=${WALLET_PEM} \
    --gas-limit 60000000 \
    --proxy=${PROXY} \
    --chain ${CHAIN} \
    --send
}

# call: registerAssociation
registerAssociation() {
    local ASSOC_ID="$1"
    local TITLE="$2"
    local DEADLINE="$3"
    local QUORUM="$4"
    local CANDIDATES="$5" # comma-separated list of addresses
    local ELIGIBLE_VOTERS="$6" # comma-separated list of addresses

    mxpy contract call ${SC_ADDRESS} \
    --function registerAssociation \
    --arguments ${ASSOC_ID} str:${TITLE} ${DEADLINE} ${QUORUM} list:${CANDIDATES} list:${ELIGIBLE_VOTERS} \
    --pem=${WALLET_PEM} \
    --gas-limit 5000000 \
    --proxy=${PROXY} \
    --chain ${CHAIN} \
    --send
}

# query: getAssocCount
getAssocCount() {
    mxpy contract query ${SC_ADDRESS} \
    --function getAssocCount \
    --proxy=${PROXY} \
    --chain ${CHAIN}
}