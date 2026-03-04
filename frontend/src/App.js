// Logic for calculating risk and profits
const calculateRiskAndProfit = (symbol, riskAmount, stopPoints, tpPoints) => {
    let riskPerContract;
    let contracts;
    let totalRisk;
    let tpProfit;

    if (symbol === 'NQ') {
        riskPerContract = stopPoints * 20;
    } else if (symbol === 'ES') {
        riskPerContract = stopPoints * 50;
    } else {
        throw new Error('Unsupported symbol');
    }
    
    contracts = Math.floor(riskAmount / riskPerContract);
    if(contracts > 40) {
        contracts = 40; // Ensuring max contracts for futures
    }

    totalRisk = contracts * riskPerContract;
    tpProfit = contracts * tpPoints * (symbol === 'NQ' ? 20 : 50);

    return {
        totalRisk: totalRisk,
        tpProfit: tpProfit,
        contracts: contracts
    };
};

// Use memoized calculation
const memoizedCalculation = useMemo(() => {
    return calculateRiskAndProfit(symbol, riskAmount, stopPoints, tpPoints);
}, [symbol, riskAmount, stopPoints, tpPoints]);
