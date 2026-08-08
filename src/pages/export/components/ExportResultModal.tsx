import { ArrowUpRightFromSquare, CircleCheck, CircleXmark } from '@gravity-ui/icons'
import { Modal, Button, Typography } from '@heroui/react'
import type { ExportResult } from '../types'

interface ExportResultModalProps {
  result: ExportResult
  /** 成功数量的单位，例如「个会话」「个联系人」「条朋友圈」 */
  unitLabel: string
  onOpenFolder: () => void
  onClose: () => void
}

export default function ExportResultModal({ result, unitLabel, onOpenFolder, onClose }: ExportResultModalProps) {
  const hasSuccess = (result.successCount ?? 0) > 0

  return (
    <Modal isOpen onOpenChange={(open) => { if (!open) onClose() }}>
      <Modal.Backdrop>
        <Modal.Container size="sm">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Icon className={hasSuccess ? 'bg-success-soft text-success-soft-foreground' : 'bg-danger-soft text-danger-soft-foreground'}>
                {hasSuccess ? <CircleCheck className="size-5" /> : <CircleXmark className="size-5" />}
              </Modal.Icon>
              <Modal.Heading>{hasSuccess ? '导出完成' : '导出失败'}</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              {result.successCount !== undefined && (
                <Typography type="body-sm" className="text-muted">
                  成功导出 {result.successCount} {unitLabel}
                  {result.failCount ? `，${result.failCount} 个失败` : ''}
                </Typography>
              )}
              {result.error && (
                <Typography type="body-sm" className="text-danger mt-2">{result.error}</Typography>
              )}
            </Modal.Body>
            <Modal.Footer>
              {hasSuccess && (
                <Button variant="tertiary" onPress={onOpenFolder}>
                  <ArrowUpRightFromSquare width={16} height={16} />
                  打开文件夹
                </Button>
              )}
              <Button slot="close" variant="primary">关闭</Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  )
}
