import { createSelector } from '@reduxjs/toolkit'
import store, { useAppDispatch, useAppSelector } from '@renderer/store'
import {
  addModel,
  addProvider,
  removeModel,
  removeProvider,
  updateModel,
  updateProvider,
  updateProviders
} from '@renderer/store/llm'
import { Assistant, Model, Provider } from '@renderer/types'
import { IpcChannel } from '@shared/IpcChannel'

import { useDefaultModel } from './useAssistant'

const selectEnabledProviders = createSelector(
  (state) => state.llm.providers,
  (providers) => providers.filter((p) => p.enabled)
)

export function useProviders() {
  const providers: Provider[] = useAppSelector(selectEnabledProviders)
  const dispatch = useAppDispatch()

  return {
    providers: providers || {},
    addProvider: (provider: Provider) => dispatch(addProvider(provider)),
    removeProvider: (provider: Provider) => dispatch(removeProvider(provider)),
    updateProvider: (provider: Provider) => dispatch(updateProvider(provider)),
    updateProviders: (providers: Provider[]) => dispatch(updateProviders(providers))
  }
}

export function useSystemProviders() {
  return useAppSelector((state) => state.llm.providers.filter((p) => p.isSystem))
}

export function useUserProviders() {
  return useAppSelector((state) => state.llm.providers.filter((p) => !p.isSystem))
}

export function useAllProviders() {
  return useAppSelector((state) => state.llm.providers)
}

export function useProvider(id: string) {
  const provider = useAppSelector((state) => state.llm.providers.find((p) => p.id === id) as Provider)
  const dispatch = useAppDispatch()

  return {
    provider,
    models: provider?.models || [],
    updateProvider: (provider: Provider) => dispatch(updateProvider(provider)),
    addModel: (model: Model) => dispatch(addModel({ providerId: id, model })),
    removeModel: (model: Model) => dispatch(removeModel({ providerId: id, model })),
    updateModel: (model: Model) => dispatch(updateModel({ providerId: id, model }))
  }
}

export function useProviderByAssistant(assistant: Assistant) {
  const { defaultModel } = useDefaultModel()
  const model = assistant.model || defaultModel
  const { provider } = useProvider(model.provider)
  return provider
}

// Listen for server changes from main process
if (window.electron?.ipcRenderer) {
  window.electron.ipcRenderer.on(IpcChannel.Provider_AddKey, (_, data) => {
    console.log('Received provider key data:', data)
    const { id, apiKey } = data
    // for now only suppor tokenflux, but in the future we can support more
    if (id === 'tokenflux') {
      if (apiKey) {
        store.dispatch(updateProvider({ id, apiKey } as Provider))
        window.message.success('Provider API key updated')
        console.log('Provider API key updated:', apiKey)
      }
    }
  })
}
