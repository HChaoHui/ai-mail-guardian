const fs = require('fs');
const path = require('path');

const DEFAULT_ACTION = {
  notify: true,
  autoReply: true,
  markSeen: true,
  notifyChannels: []
};

function readJsonIfExists(filePath) {
  const resolvedPath = path.resolve(filePath);

  if (!fs.existsSync(resolvedPath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
}

function getValue(context, key) {
  const map = {
    category: context.analysis?.category,
    priority: context.analysis?.priority,
    securityRisk: context.analysis?.securityRisk,
    needsHumanReview: context.analysis?.needsHumanReview,
    needsReply: context.analysis?.needsReply,
    accountName: context.mail?.accountName,
    from: context.mail?.from,
    fromDomain: context.mail?.sourceRisk?.fromDomain,
    sourceRiskLevel: context.mail?.sourceRisk?.level
  };

  return map[key];
}

function matchValue(actual, expected) {
  if (Array.isArray(expected)) {
    return expected.includes(actual);
  }

  if (expected && typeof expected === 'object') {
    if (expected.includes) {
      return String(actual || '').includes(expected.includes);
    }

    if (expected.regex) {
      return new RegExp(expected.regex, expected.flags || '').test(String(actual || ''));
    }
  }

  return actual === expected;
}

function matchesRule(rule, context) {
  const conditions = rule.if || {};

  return Object.entries(conditions).every(([key, expected]) => {
    return matchValue(getValue(context, key), expected);
  });
}

function loadRules(filePath) {
  const config = readJsonIfExists(filePath || 'rules.json') || {};

  return {
    rules: Array.isArray(config.rules) ? config.rules : [],
    defaultAction: {
      ...DEFAULT_ACTION,
      ...(config.defaultAction || {})
    }
  };
}

function evaluateRules(ruleConfig, context) {
  const matchedRules = ruleConfig.rules.filter(rule => rule.enabled !== false && matchesRule(rule, context));
  const action = matchedRules.reduce((current, rule) => ({
    ...current,
    ...(rule.then || {})
  }), { ...ruleConfig.defaultAction });

  return {
    ...action,
    matchedRules: matchedRules.map(rule => rule.name || '未命名规则')
  };
}

module.exports = {
  evaluateRules,
  loadRules
};
