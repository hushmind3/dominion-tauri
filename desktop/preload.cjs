'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('dominionDesktop',Object.freeze({
 pickModel:(format)=>ipcRenderer.invoke('dominion:pick-model',format==='mlx'?'mlx':'gguf'),
 pickVideo:()=>ipcRenderer.invoke('dominion:pick-video'),
 pickDirectory:()=>ipcRenderer.invoke('dominion:pick-directory'),
 showItem:(target)=>ipcRenderer.invoke('dominion:show-item',target),
 openPath:(target)=>ipcRenderer.invoke('dominion:open-path',target),
 openPreview:(url)=>ipcRenderer.invoke('dominion:open-preview',url),
 applyUpdate:(installer)=>ipcRenderer.invoke('dominion:apply-update',installer)
}));
