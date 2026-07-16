import { useCallback, useEffect, useRef } from "react"

export const useDemoPictureUpload = () => {
  const pictureUrlsRef = useRef(new Set<string>())

  useEffect(
    () => () => {
      for (const url of pictureUrlsRef.current) URL.revokeObjectURL(url)
    },
    []
  )

  return useCallback(async (base64: string): Promise<string> => {
    const response = await globalThis.fetch(base64)
    const pictureUrl = URL.createObjectURL(await response.blob())
    pictureUrlsRef.current.add(pictureUrl)
    return pictureUrl
  }, [])
}
