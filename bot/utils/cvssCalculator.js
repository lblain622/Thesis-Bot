// cvssCalculator.js
/**
 * CVSS v3.1 Calculator
 * Calculates CVSS scores based on metric values
 */

// CVSS v3.1 Metric Weights and Formulas
const cvssMetrics = {
    attackVector: {
        N: { value: 'N', label: 'Network', weight: 0.85 },
        A: { value: 'A', label: 'Adjacent', weight: 0.62 },
        L: { value: 'L', label: 'Local', weight: 0.55 },
        P: { value: 'P', label: 'Physical', weight: 0.2 }
    },
    attackComplexity: {
        L: { value: 'L', label: 'Low', weight: 0.77 },
        H: { value: 'H', label: 'High', weight: 0.44 }
    },
    privilegesRequired: {
        N: { value: 'N', label: 'None', weight: 0.85 },
        L: { value: 'L', label: 'Low', weight: 0.62, scopeChanged: 0.68 },
        H: { value: 'H', label: 'High', weight: 0.27, scopeChanged: 0.5 }
    },
    userInteraction: {
        N: { value: 'N', label: 'None', weight: 0.85 },
        R: { value: 'R', label: 'Required', weight: 0.62 }
    },
    scope: {
        U: { value: 'U', label: 'Unchanged' },
        C: { value: 'C', label: 'Changed' }
    },
    confidentiality: {
        N: { value: 'N', label: 'None', weight: 0 },
        L: { value: 'L', label: 'Low', weight: 0.22 },
        H: { value: 'H', label: 'High', weight: 0.56 }
    },
    integrity: {
        N: { value: 'N', label: 'None', weight: 0 },
        L: { value: 'L', label: 'Low', weight: 0.22 },
        H: { value: 'H', label: 'High', weight: 0.56 }
    },
    availability: {
        N: { value: 'N', label: 'None', weight: 0 },
        L: { value: 'L', label: 'Low', weight: 0.22 },
        H: { value: 'H', label: 'High', weight: 0.56 }
    }
};

/**
 * Calculate CVSS v3.1 Base Score
 * @param {Object} metrics - CVSS metric values
 * @returns {Object} - Score, severity, and vector string
 */
function calculateCVSS(metrics) {
    // Validate input metrics
    if (!metrics || typeof metrics !== 'object') {
        throw new Error('Metrics object is required');
    }

    const requiredMetrics = ['attackVector', 'attackComplexity', 'privilegesRequired',
                           'userInteraction', 'scope', 'confidentiality', 'integrity', 'availability'];

    for (const metric of requiredMetrics) {
        if (!metrics[metric]) {
            throw new Error(`Missing required metric: ${metric}`);
        }
    }

    // Extract metric values
    const AV = metrics.attackVector;
    const AC = metrics.attackComplexity;
    const PR = metrics.privilegesRequired;
    const UI = metrics.userInteraction;
    const S = metrics.scope;
    const C = metrics.confidentiality;
    const I = metrics.integrity;
    const A = metrics.availability;

    // Calculate Impact Sub-Score (ISS)
    const ISS = 1 - ((1 - cvssMetrics.confidentiality[C].weight) *
                     (1 - cvssMetrics.integrity[I].weight) *
                     (1 - cvssMetrics.availability[A].weight));

    // Calculate Impact Score
    let impactScore;
    if (S === 'U') {
        impactScore = 6.42 * ISS;
    } else { // Scope Changed
        impactScore = 7.52 * (ISS - 0.029) - 3.25 * Math.pow(ISS - 0.02, 15);
    }

    impactScore = Math.min(impactScore, 10); // Cap at 10
    impactScore = impactScore <= 0 ? 0 : impactScore; // Ensure non-negative

    // Calculate Exploitability Score
    let exploitability;
    if (S === 'U') {
        exploitability = 8.22 * cvssMetrics.attackVector[AV].weight *
                        cvssMetrics.attackComplexity[AC].weight *
                        cvssMetrics.privilegesRequired[PR].weight *
                        cvssMetrics.userInteraction[UI].weight;
    } else { // Scope Changed
        const prWeight = cvssMetrics.privilegesRequired[PR].scopeChanged || cvssMetrics.privilegesRequired[PR].weight;
        exploitability = 8.22 * cvssMetrics.attackVector[AV].weight *
                        cvssMetrics.attackComplexity[AC].weight *
                        prWeight *
                        cvssMetrics.userInteraction[UI].weight;
    }

    // Calculate Base Score
    let baseScore;
    if (impactScore <= 0) {
        baseScore = 0;
    } else if (S === 'U') {
        baseScore = Math.ceil(Math.min(impactScore + exploitability, 10) * 10) / 10;
    } else { // Scope Changed
        baseScore = Math.ceil(Math.min(1.08 * (impactScore + exploitability), 10) * 10) / 10;
    }

    // Round to 1 decimal place
    baseScore = Math.round(baseScore * 10) / 10;

    // Determine Severity
    const severity = getSeverity(baseScore);

    // Generate CVSS Vector String
    const vectorString = generateVectorString(metrics);

    return {
        score: baseScore,
        severity: severity,
        vector: vectorString,
        impactScore: Math.round(impactScore * 10) / 10,
        exploitabilityScore: Math.round(exploitability * 10) / 10
    };
}

/**
 * Determine severity based on CVSS score
 * @param {number} score - CVSS base score
 * @returns {string} - Severity level
 */
function getSeverity(score) {
    if (score >= 9.0) return 'Critical';
    if (score >= 7.0) return 'High';
    if (score >= 4.0) return 'Medium';
    if (score >= 0.1) return 'Low';
    return 'None';
}

/**
 * Generate CVSS vector string
 * @param {Object} metrics - CVSS metric values
 * @returns {string} - CVSS vector string
 */
function generateVectorString(metrics) {
    const vectorParts = [
        `AV:${metrics.attackVector}`,
        `AC:${metrics.attackComplexity}`,
        `PR:${metrics.privilegesRequired}`,
        `UI:${metrics.userInteraction}`,
        `S:${metrics.scope}`,
        `C:${metrics.confidentiality}`,
        `I:${metrics.integrity}`,
        `A:${metrics.availability}`
    ];

    return `CVSS:3.1/${vectorParts.join('/')}`;
}

/**
 * Parse CVSS vector string into metrics object
 * @param {string} vectorString - CVSS vector string
 * @returns {Object} - Parsed metrics object
 */
function parseVectorString(vectorString) {
    if (!vectorString || !vectorString.startsWith('CVSS:3.1/')) {
        throw new Error('Invalid CVSS vector string format');
    }

    const metrics = {};
    const parts = vectorString.replace('CVSS:3.1/', '').split('/');

    for (const part of parts) {
        const [metric, value] = part.split(':');
        switch (metric) {
            case 'AV': metrics.attackVector = value; break;
            case 'AC': metrics.attackComplexity = value; break;
            case 'PR': metrics.privilegesRequired = value; break;
            case 'UI': metrics.userInteraction = value; break;
            case 'S': metrics.scope = value; break;
            case 'C': metrics.confidentiality = value; break;
            case 'I': metrics.integrity = value; break;
            case 'A': metrics.availability = value; break;
        }
    }

    return metrics;
}

/**
 * Get all possible values for a specific metric
 * @param {string} metricName - Name of the metric
 * @returns {Array} - Array of possible values with labels
 */
function getMetricOptions(metricName) {
    const metric = cvssMetrics[metricName];
    if (!metric) {
        throw new Error(`Unknown metric: ${metricName}`);
    }

    return Object.values(metric).map(option => ({
        value: option.value,
        label: option.label,
        description: option.description || `CVSS ${metricName}: ${option.label}`
    }));
}

/**
 * Validate CVSS metrics object
 * @param {Object} metrics - CVSS metrics to validate
 * @returns {Object} - Validation result
 */
function validateMetrics(metrics) {
    const errors = [];

    for (const [metric, value] of Object.entries(metrics)) {
        if (!cvssMetrics[metric]) {
            errors.push(`Unknown metric: ${metric}`);
            continue;
        }

        if (!cvssMetrics[metric][value]) {
            const validValues = Object.keys(cvssMetrics[metric]).join(', ');
            errors.push(`Invalid value '${value}' for metric ${metric}. Valid values: ${validValues}`);
        }
    }

    return {
        isValid: errors.length === 0,
        errors: errors
    };
}

// Export functions
module.exports = {
    calculateCVSS,
    getSeverity,
    generateVectorString,
    parseVectorString,
    getMetricOptions,
    validateMetrics,
    cvssMetrics
};