import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react"
import { validatePictureFile, type PictureUploadInstaller } from "./pictureUpload"

export interface PictureUploadDialogProps {
  readonly installer: PictureUploadInstaller
  readonly uploadId?: string
  readonly anchor?: HTMLElement
  readonly onConfirm: (file: File) => string | null
  readonly onClose: () => void
}

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "图片上传失败"
}

export function PictureUploadDialog(props: PictureUploadDialogProps) {
  const { installer, uploadId } = props
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [validating, setValidating] = useState(false)
  const [valid, setValid] = useState(false)
  const [selectionError, setSelectionError] = useState<string | null>(null)
  const [uploadState, setUploadState] = useState(() => installer.getState())
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const selectRef = useRef<HTMLButtonElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const latestClose = useRef(props.onClose)
  const hadUpload = useRef(false)
  useLayoutEffect(() => { latestClose.current = props.onClose })

  useLayoutEffect(() => {
    setUploadState(installer.getState())
    return installer.subscribe(setUploadState)
  }, [installer])

  useEffect(() => {
    let active = true
    let objectUrl: string | null = null
    setPreview(null)
    setValid(false)
    setSelectionError(null)
    setConfirmError(null)
    if (!file) {
      setValidating(false)
      return () => { active = false }
    }
    setValidating(true)
    validatePictureFile(file).then(() => {
      if (!active) return
      objectUrl = URL.createObjectURL(file)
      setPreview(objectUrl)
      setValid(true)
      setValidating(false)
    }, (error) => {
      if (!active) return
      setSelectionError(errorText(error))
      setValidating(false)
    })
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [file])

  const uploadItem = uploadId ? uploadState.items.find((item) => item.uploadId === uploadId) : undefined
  useEffect(() => {
    if (uploadId && uploadItem) hadUpload.current = true
    if (uploadId && hadUpload.current && !uploadItem) {
      hadUpload.current = false
      latestClose.current()
    }
  }, [uploadId, uploadItem])

  useEffect(() => {
    const previous = props.anchor ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    selectRef.current?.focus()
    return () => {
      if (previous?.isConnected) previous.focus({ preventScroll: true })
    }
  }, [props.anchor])

  const choose = (next: File | undefined): void => {
    if (next && !uploadId) setFile(next)
  }

  const confirm = (): void => {
    if (!file || !valid || validating || uploadId) return
    const id = props.onConfirm(file)
    if (!id) setConfirmError("目标块已不存在或当前不可插图")
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      props.onClose()
      return
    }
    if (event.key !== "Tab") return
    const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)") ?? [])
      .filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true")
    const first = controls[0]
    const last = controls[controls.length - 1]
    if (!first || !last) return
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const drop = (event: DragEvent<HTMLButtonElement>): void => {
    event.preventDefault()
    choose(event.dataTransfer.files[0])
  }

  const failed = uploadItem?.status === "failed"
  return <div className="hn-picture-dialog-backdrop">
    <div
      ref={dialogRef}
      className="hn-picture-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="hn-picture-dialog-title"
      onKeyDown={onKeyDown}
    >
      <button type="button" className="hn-picture-dialog__close" aria-label="关闭图像对话框" onClick={props.onClose}>×</button>
      <h2 id="hn-picture-dialog-title">插入图像</h2>
      <button
        ref={selectRef}
        type="button"
        className="hn-picture-dialog__dropzone"
        disabled={!!uploadId}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => event.preventDefault()}
        onDrop={drop}
      >
        {file ? file.name : "点击选择或拖入一张图片"}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
        hidden
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          choose(event.currentTarget.files?.[0])
          event.currentTarget.value = ""
        }}
      />
      {validating && <p role="status">正在校验图片…</p>}
      {preview && <img className="hn-picture-dialog__preview" src={preview} alt="图片预览" />}
      {(selectionError || confirmError) && <p className="hn-picture-dialog__error" role="alert">{selectionError ?? confirmError}</p>}
      {uploadItem && <div className="hn-picture-dialog__upload" data-status={uploadItem.status}>
        {uploadItem.status === "uploading" ? <p role="status">上传中（第 {uploadItem.attempt} 次尝试）…</p> : <p className="hn-picture-dialog__error" role="alert">{errorText(uploadItem.error)}</p>}
        {failed && <button type="button" onClick={() => installer.retry(uploadItem.uploadId)}>重试上传</button>}
      </div>}
      <div className="hn-picture-dialog__actions">
        <button type="button" onClick={props.onClose}>取消</button>
        <button type="button" className="hn-picture-dialog__confirm" disabled={!file || !valid || validating || !!uploadId} onClick={confirm}>确认插入</button>
      </div>
    </div>
  </div>
}
