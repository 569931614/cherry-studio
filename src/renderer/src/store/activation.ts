import { createSlice, PayloadAction } from '@reduxjs/toolkit'

export interface ActivationState {
  isActivated: boolean
  activationCode: string | null
  machineCode: string | null
  userInfo: {
    nickname?: string
    account_id?: string
    user_type?: number
    expired_time?: number
    groups?: string[]
  } | null
  isChecking: boolean
  isActivating: boolean
  lastCheckTime: number | null
  error: string | null
}

const initialState: ActivationState = {
  isActivated: false,
  activationCode: null,
  machineCode: null,
  userInfo: null,
  isChecking: false,
  isActivating: false,
  lastCheckTime: null,
  error: null
}

const activationSlice = createSlice({
  name: 'activation',
  initialState,
  reducers: {
    setActivationStatus: (state, action: PayloadAction<boolean>) => {
      state.isActivated = action.payload
      if (!action.payload) {
        state.userInfo = null
      }
    },
    setActivationCode: (state, action: PayloadAction<string | null>) => {
      state.activationCode = action.payload
    },
    setMachineCode: (state, action: PayloadAction<string | null>) => {
      state.machineCode = action.payload
    },
    setUserInfo: (state, action: PayloadAction<ActivationState['userInfo']>) => {
      state.userInfo = action.payload
    },
    setChecking: (state, action: PayloadAction<boolean>) => {
      state.isChecking = action.payload
    },
    setActivating: (state, action: PayloadAction<boolean>) => {
      state.isActivating = action.payload
    },
    setLastCheckTime: (state, action: PayloadAction<number>) => {
      state.lastCheckTime = action.payload
    },
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload
    },
    resetActivation: (state) => {
      state.isActivated = false
      state.activationCode = null
      state.userInfo = null
      state.error = null
      state.lastCheckTime = null
    },
    activateSuccess: (state, action: PayloadAction<{
      activationCode: string
      userInfo: ActivationState['userInfo']
    }>) => {
      state.isActivated = true
      state.activationCode = action.payload.activationCode
      state.userInfo = action.payload.userInfo
      state.isActivating = false
      state.error = null
      state.lastCheckTime = Date.now()
    }
  }
})

export const {
  setActivationStatus,
  setActivationCode,
  setMachineCode,
  setUserInfo,
  setChecking,
  setActivating,
  setLastCheckTime,
  setError,
  resetActivation,
  activateSuccess
} = activationSlice.actions

export default activationSlice.reducer
