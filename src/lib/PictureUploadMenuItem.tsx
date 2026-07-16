import { type ChangeEvent, type RefCallback, useRef, useState } from "react"

import type { PictureUploadPayload } from "./BlockActionMenu"

type PictureUploadMenuItemProps = {
  readonly buttonRef: RefCallback<HTMLButtonElement>
  readonly onPictureUpload: (picture: PictureUploadPayload) => Promise<void>
}

type UploadState = "idle" | "uploading" | "failed"

const readPictureDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result)
        return
      }
      reject(new Error("Picture could not be read as a data URL."))
    })
    reader.addEventListener("error", () =>
      reject(reader.error ?? new Error("Picture could not be read."))
    )
    reader.readAsDataURL(file)
  })

const readPictureDimensions = async (
  file: File
): Promise<Pick<PictureUploadPayload, "width" | "height">> => {
  if (typeof globalThis.createImageBitmap !== "function") {
    return { width: undefined, height: undefined }
  }

  return globalThis.createImageBitmap(file).then(
    (bitmap) => {
      const dimensions = { width: bitmap.width, height: bitmap.height }
      bitmap.close()
      return dimensions
    },
    () => ({ width: undefined, height: undefined })
  )
}

export const PictureUploadMenuItem = ({
  buttonRef,
  onPictureUpload
}: PictureUploadMenuItemProps) => {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [uploadState, setUploadState] = useState<UploadState>("idle")

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    const file = input.files?.[0]
    input.value = ""
    if (!file) return

    setUploadState("uploading")
    void Promise.all([readPictureDataUrl(file), readPictureDimensions(file)])
      .then(([base64, dimensions]) =>
        onPictureUpload({ base64, filename: file.name, ...dimensions })
      )
      .catch(() => setUploadState("failed"))
  }

  const label =
    uploadState === "uploading"
      ? "上传中…"
      : uploadState === "failed"
        ? "上传失败，重试"
        : "图片"

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        role="menuitem"
        className="hn-note-block-menu-item"
        aria-busy={uploadState === "uploading"}
        aria-disabled={uploadState === "uploading"}
        tabIndex={-1}
        onClick={() => {
          if (uploadState !== "uploading") inputRef.current?.click()
        }}
      >
        <span
          className="hn-note-block-menu-item-label"
          aria-live="polite"
          aria-atomic="true"
        >
          {label}
        </span>
      </button>
      <input
        ref={inputRef}
        className="hn-note-picture-input"
        type="file"
        accept="image/*"
        tabIndex={-1}
        aria-hidden="true"
        onChange={handleFileChange}
      />
    </>
  )
}
