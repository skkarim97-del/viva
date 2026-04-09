const { withEntitlementsPlist, withInfoPlist } = require("expo/config-plugins");

function withHealthKit(config) {
  config = withEntitlementsPlist(config, (mod) => {
    mod.modResults["com.apple.developer.healthkit"] = true;
    mod.modResults["com.apple.developer.healthkit.access"] = [];
    return mod;
  });

  config = withInfoPlist(config, (mod) => {
    mod.modResults.NSHealthShareUsageDescription =
      "VIVA reads your health data including sleep, steps, heart rate, and HRV to provide personalized wellness coaching and daily plans.";
    mod.modResults.NSHealthUpdateUsageDescription =
      "VIVA uses write access to sync your wellness goals with Apple Health.";
    if (!mod.modResults.UIBackgroundModes) {
      mod.modResults.UIBackgroundModes = [];
    }
    return mod;
  });

  return config;
}

module.exports = withHealthKit;
