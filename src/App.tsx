import { useEffect } from 'react'
import { Scene } from './components/scene/Scene'
import { StatusHint, Toast, Tooltip } from './components/ui/Overlays'
import { Assistant } from './components/ui/Assistant'
import { Palette } from './components/ui/Palette'
import { Problems } from './components/ui/Problems'
import { Properties } from './components/ui/Properties'
import { SchematicPanel } from './components/ui/SchematicPanel'
import { Toolbar } from './components/ui/Toolbar'
import { useStore } from './store/useStore'

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return
      const s = useStore.getState()
      const k = e.key.toLowerCase()
      const mod = e.ctrlKey || e.metaKey
      if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); s.redo() }
      else if (mod && k === 'z') { e.preventDefault(); s.undo() }
      else if (mod) return
      else if (k === 'r') s.rotateSelected()
      else if (k === 'delete' || k === 'backspace') s.deleteSelected()
      else if (k === 'escape') s.cancel()
      else if (k === ' ' && t.tagName !== 'BUTTON') { e.preventDefault(); if (s.running) s.stop(); else s.start() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

export function App() {
  useShortcuts()
  const assistant = useStore((s) => s.assistant)
  const setAssistant = useStore((s) => s.setAssistant)
  return (
    <div className="flex h-full flex-col">
      <Toolbar />
      <div className="flex min-h-0 flex-1">
        <Palette />
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="relative isolate min-h-0 flex-1 overflow-hidden" data-testid="workspace" onContextMenu={(e) => e.preventDefault()}>
            <Scene />
            <Problems />
            <StatusHint />
            <Toast />
          </div>
          <SchematicPanel />
        </main>
        <Properties />
        {assistant && <Assistant close={() => setAssistant(false)} />}
      </div>
      <Tooltip />
    </div>
  )
}
