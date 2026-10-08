'use strict';

const bool=value=>value===true;
// Only the automations exposed by the server panel are accepted. Hunt selection
// is intentionally fixed to XP; no unexposed gold/alert/collection controls.
// `enabled` turns the whole profile off: the launcher unloads that game view.
const defaults=Object.freeze({xpPriority:100,enabled:true,autoHunts:false,autoCapture:false,autoBuyBalls:false,autoBuyPotions:false});
function normalizeSettings(value={}){
  return {xpPriority:100,enabled:value.enabled!==false,autoHunts:bool(value.autoHunts),autoCapture:bool(value.autoCapture),autoBuyBalls:bool(value.autoBuyBalls),autoBuyPotions:bool(value.autoBuyPotions)};
}
function pauseSettings(settings={}){return normalizeSettings({...settings,autoHunts:false,autoCapture:false,autoBuyBalls:false,autoBuyPotions:false});}
module.exports={defaults,normalizeSettings,pauseSettings};
