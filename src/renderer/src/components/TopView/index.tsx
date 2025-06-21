import TopViewMinappContainer from '@renderer/components/MinApp/TopViewMinappContainer'
import { useAppInit } from '@renderer/hooks/useAppInit'
import { message, Modal } from 'antd'
import React, { PropsWithChildren, useCallback, useEffect, useRef, useState } from 'react'

import { Box } from '../Layout'

let onPop = () => {}
let onShow = ({ element, id }: { element: React.FC | React.ReactNode; id: string }) => {
  element
  id
}
let onHide = (id: string) => {
  id
}
let onHideAll = () => {}

interface Props {
  children?: React.ReactNode
}

type ElementItem = {
  id: string
  element: React.FC | React.ReactNode
}

const TopViewContainer: React.FC<Props> = ({ children }) => {
  const [elements, setElements] = useState<ElementItem[]>([])
  const elementsRef = useRef<ElementItem[]>([])
  elementsRef.current = elements

  const [messageApi, messageContextHolder] = message.useMessage()
  const [modal, modalContextHolder] = Modal.useModal()

  useAppInit()

  useEffect(() => {
    window.message = messageApi
    window.modal = modal
  }, [messageApi, modal])

  onPop = () => {
    const views = [...elementsRef.current]
    views.pop()
    elementsRef.current = views
    setElements(elementsRef.current)
  }

  onShow = ({ element, id }: ElementItem) => {
    if (!elementsRef.current.find((el) => el.id === id)) {
      elementsRef.current = elementsRef.current.concat([{ element, id }])
      setElements(elementsRef.current)
    }
  }

  onHide = (id: string) => {
    elementsRef.current = elementsRef.current.filter((el) => el.id !== id)
    setElements(elementsRef.current)
  }

  onHideAll = () => {
    setElements([])
    elementsRef.current = []
  }

  const FullScreenContainer: React.FC<PropsWithChildren> = useCallback(({ children }) => {
    return (
      <Box
        position="fixed"
        w="100%"
        h="100%"
        className="topview-fullscreen-container"
        style={{
          zIndex: 9998, // 容器基础层级
          top: 0,
          left: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        {/* 背景遮罩层 */}
        <Box
          position="absolute"
          w="100%"
          h="100%"
          style={{
            backgroundColor: 'rgba(0,0,0,0.5)',
            zIndex: 9999 // 遮罩层级
          }}
          onClick={(e) => {
            // 检查是否是激活弹窗，如果是则不允许关闭
            const isActivationPopup = elementsRef.current.some(el => el.id === 'ActivationPopup')
            if (isActivationPopup) {
              e.preventDefault()
              e.stopPropagation()
              return
            }
            onPop()
          }}
        />
        {/* 弹窗内容层 */}
        <Box style={{ zIndex: 10003, position: 'relative' }}>
          {children}
        </Box>
      </Box>
    )
  }, [])



  return (
    <>
      {children}
      {messageContextHolder}
      {modalContextHolder}
      <TopViewMinappContainer />
      {elements.map(({ element: Element, id }) => (
        <FullScreenContainer key={`TOPVIEW_${id}`}>
          {typeof Element === 'function' ? <Element /> : Element}
        </FullScreenContainer>
      ))}
    </>
  )
}

export const TopView = {
  show: (element: React.FC | React.ReactNode, id: string) => onShow({ element, id }),
  hide: (id: string) => onHide(id),
  clear: () => onHideAll(),
  pop: onPop
}

export default TopViewContainer
