// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Built-in Keymap Presets for VSCode, Vim, and Sublime Text.
 * Issue #2077: Integrate Vim/Sublime/VSCode keymap presets with user toggle.
 */

import type { KeymapPreset, ShortcutItem } from "@/types/shortcuts";

export const VSCODE_SHORTCUTS: ShortcutItem[] = [
  {
    id: "editor.save",
    label: "Save & Format Contract",
    description: "Format Rust contract code and trigger local persistence",
    category: "editor",
    defaultKey: "Mod+S",
    actionId: "soroban.format-rust",
  },
  {
    id: "palette.spotlight",
    label: "Spotlight Command Palette",
    description: "Open the global command palette and search bar",
    category: "general",
    defaultKey: "Mod+K",
    actionId: "spotlight.open",
  },
  {
    id: "navigation.quick_open",
    label: "Quick Open File / Template",
    description: "Browse contract templates and open files quickly",
    category: "navigation",
    defaultKey: "Mod+P",
    actionId: "navigation.quick_open",
  },
  {
    id: "view.toggle_sidebar",
    label: "Toggle Sidebar",
    description: "Expand or collapse the primary navigation sidebar",
    category: "navigation",
    defaultKey: "Mod+B",
    actionId: "sidebar.toggle",
  },
  {
    id: "editor.find",
    label: "Find in Editor",
    description: "Open find and replace in Monaco editor",
    category: "editor",
    defaultKey: "Mod+F",
    actionId: "actions.find",
  },
  {
    id: "build.compile",
    label: "Build & Compile WASM",
    description: "Compile Soroban smart contract to WASM artifact",
    category: "build",
    defaultKey: "Mod+Shift+B",
    actionId: "build.compile",
  },
  {
    id: "build.deploy",
    label: "Deploy Contract",
    description: "Deploy compiled contract byte-code to the active network",
    category: "build",
    defaultKey: "Mod+Enter",
    actionId: "build.deploy",
  },
  {
    id: "general.shortcuts_modal",
    label: "Keyboard Shortcuts Customizer",
    description: "Open the keyboard shortcuts and keymap preset manager",
    category: "general",
    defaultKey: "Mod+/",
    actionId: "shortcuts.modal.open",
  },
  {
    id: "editor.toggle_vim",
    label: "Toggle Monaco Vim Mode",
    description: "Switch Monaco editor between standard and Vim modal editing",
    category: "editor",
    defaultKey: "Mod+Alt+V",
    actionId: "editor.toggle_vim",
  },
  {
    id: "offline.sync",
    label: "Sync Offline Workspace",
    description: "Push queued changes to the cloud when connected",
    category: "general",
    defaultKey: "Mod+Shift+S",
    actionId: "sync.now",
  },
  {
    id: "view.toggle_theme",
    label: "Toggle Theme Mode",
    description: "Switch between dark and light appearance modes",
    category: "general",
    defaultKey: "Mod+Alt+T",
    actionId: "theme.toggle",
  },
];

export const VIM_SHORTCUTS: ShortcutItem[] = [
  {
    id: "editor.save",
    label: "Save & Format Contract (:w)",
    description: "Write and format Rust contract source file",
    category: "editor",
    defaultKey: "Mod+S",
    actionId: "soroban.format-rust",
  },
  {
    id: "palette.spotlight",
    label: "Command Palette",
    description: "Open spotlight command palette",
    category: "general",
    defaultKey: "Mod+K",
    actionId: "spotlight.open",
  },
  {
    id: "navigation.quick_open",
    label: "Buffer / Template Explorer",
    description: "Jump to template or contract file",
    category: "navigation",
    defaultKey: "Mod+P",
    actionId: "navigation.quick_open",
  },
  {
    id: "view.toggle_sidebar",
    label: "Toggle File Drawer",
    description: "Toggle explorer sidebar visibility",
    category: "navigation",
    defaultKey: "Mod+B",
    actionId: "sidebar.toggle",
  },
  {
    id: "editor.find",
    label: "Search Pattern (/)",
    description: "Search forward within document buffer",
    category: "editor",
    defaultKey: "/",
    actionId: "actions.find",
  },
  {
    id: "build.compile",
    label: "Make / Compile Contract (:make)",
    description: "Compile Soroban Rust smart contract to WebAssembly",
    category: "build",
    defaultKey: "Mod+Shift+B",
    actionId: "build.compile",
  },
  {
    id: "build.deploy",
    label: "Deploy Contract",
    description: "Deploy compiled contract byte-code to the active network",
    category: "build",
    defaultKey: "Mod+Enter",
    actionId: "build.deploy",
  },
  {
    id: "general.shortcuts_modal",
    label: "Keymap & Cheat-sheet Help (?)",
    description: "Display keyboard shortcuts customizer modal",
    category: "general",
    defaultKey: "?",
    actionId: "shortcuts.modal.open",
  },
  {
    id: "editor.toggle_vim",
    label: "Toggle Monaco Vim Mode",
    description: "Enable or disable Monaco Vim modal editing",
    category: "editor",
    defaultKey: "Mod+Alt+V",
    actionId: "editor.toggle_vim",
  },
  {
    id: "offline.sync",
    label: "Sync Workspace Queue",
    description: "Push queued transactions and offline files",
    category: "general",
    defaultKey: "Mod+Shift+S",
    actionId: "sync.now",
  },
  {
    id: "view.toggle_theme",
    label: "Toggle Theme Mode",
    description: "Switch between dark and light appearance modes",
    category: "general",
    defaultKey: "Mod+Alt+T",
    actionId: "theme.toggle",
  },
];

export const SUBLIME_SHORTCUTS: ShortcutItem[] = [
  {
    id: "editor.save",
    label: "Save & Format Contract",
    description: "Save file and format Rust contract code",
    category: "editor",
    defaultKey: "Mod+S",
    actionId: "soroban.format-rust",
  },
  {
    id: "palette.spotlight",
    label: "Command Palette",
    description: "Open the Sublime-style command palette",
    category: "general",
    defaultKey: "Mod+Shift+P",
    actionId: "spotlight.open",
  },
  {
    id: "navigation.quick_open",
    label: "Goto Anything...",
    description: "Quick open templates and files",
    category: "navigation",
    defaultKey: "Mod+P",
    actionId: "navigation.quick_open",
  },
  {
    id: "view.toggle_sidebar",
    label: "Toggle Side Bar",
    description: "Hide or show the navigation side bar",
    category: "navigation",
    defaultKey: "Mod+Alt+B",
    actionId: "sidebar.toggle",
  },
  {
    id: "editor.find",
    label: "Find",
    description: "Find in current document",
    category: "editor",
    defaultKey: "Mod+F",
    actionId: "actions.find",
  },
  {
    id: "build.compile",
    label: "Build",
    description: "Compile Soroban smart contract (Sublime standard Mod+B)",
    category: "build",
    defaultKey: "Mod+B",
    actionId: "build.compile",
  },
  {
    id: "build.deploy",
    label: "Deploy Contract",
    description: "Deploy contract to Soroban network",
    category: "build",
    defaultKey: "Mod+Enter",
    actionId: "build.deploy",
  },
  {
    id: "general.shortcuts_modal",
    label: "Show Keyboard Shortcuts",
    description: "Open the keyboard shortcuts customizer",
    category: "general",
    defaultKey: "Mod+/",
    actionId: "shortcuts.modal.open",
  },
  {
    id: "editor.toggle_vim",
    label: "Toggle Monaco Vim Mode",
    description: "Toggle Vim modal editing in Monaco",
    category: "editor",
    defaultKey: "Mod+Alt+V",
    actionId: "editor.toggle_vim",
  },
  {
    id: "offline.sync",
    label: "Sync Offline Workspace",
    description: "Synchronize local offline changes",
    category: "general",
    defaultKey: "Mod+Shift+S",
    actionId: "sync.now",
  },
  {
    id: "view.toggle_theme",
    label: "Toggle Theme Mode",
    description: "Switch between dark and light appearance modes",
    category: "general",
    defaultKey: "Mod+Alt+T",
    actionId: "theme.toggle",
  },
];

export const PRESET_MAP: Record<KeymapPreset, ShortcutItem[]> = {
  vscode: VSCODE_SHORTCUTS,
  vim: VIM_SHORTCUTS,
  sublime: SUBLIME_SHORTCUTS,
};

export const PRESET_LABELS: Record<KeymapPreset, { name: string; description: string }> = {
  vscode: {
    name: "VSCode",
    description: "Standard Visual Studio Code keyboard bindings and defaults",
  },
  vim: {
    name: "Vim",
    description: "Modal navigation, buffer commands, and Monaco Vim integration",
  },
  sublime: {
    name: "Sublime Text",
    description: "Classic Sublime Text shortcuts (Mod+Shift+P palette, Mod+B build)",
  },
};
