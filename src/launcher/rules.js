const { minecraftOsName, minecraftArch } = require('./os');

function osMatches(ruleOs = {}, env = {}) {
  const currentName = env.name || minecraftOsName();
  const currentArch = env.arch || minecraftArch();
  const currentVersion = env.version || require('node:os').release();

  if (ruleOs.name && ruleOs.name !== currentName) return false;
  if (ruleOs.arch && ruleOs.arch !== currentArch) return false;
  if (ruleOs.version) {
    try {
      const regex = new RegExp(ruleOs.version);
      if (!regex.test(currentVersion)) return false;
    } catch (_) {
      return false;
    }
  }
  return true;
}

function featuresMatch(ruleFeatures = {}, features = {}) {
  for (const [name, expected] of Object.entries(ruleFeatures)) {
    if (Boolean(features[name]) !== Boolean(expected)) return false;
  }
  return true;
}

function isAllowedByRules(rules, env = {}, features = {}) {
  if (!Array.isArray(rules) || rules.length === 0) return true;

  let allowed = false;
  for (const rule of rules) {
    const osOk = !rule.os || osMatches(rule.os, env);
    const featuresOk = !rule.features || featuresMatch(rule.features, features);
    if (osOk && featuresOk) {
      allowed = rule.action === 'allow';
    }
  }
  return allowed;
}

module.exports = {
  isAllowedByRules,
  osMatches,
  featuresMatch
};
