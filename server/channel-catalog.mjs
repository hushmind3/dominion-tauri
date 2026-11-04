// Backwards-compatible facade: source of truth is channel-plugins/*/manifest.json.
// No hard-coded channel IDs or driver list in the execution core.
import {listChannels,channelManifest,validateChannel} from './channel-registry.mjs';
export const channelCatalog=()=>listChannels();
export const channelDefinition=id=>channelManifest(id);
export const validateChannelConfiguration=(kind,record,credentials)=>validateChannel(kind,record,credentials);
