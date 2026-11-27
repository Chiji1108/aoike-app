import { useRouter } from "@tanstack/react-router"
import { DeleteDialog } from "@/components/cases/delete-dialog"
import { useCase, useCaseActions, useCaseSession } from "@/components/cases/store/context"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { DownloadsDialog } from "./downloads-dialog"

/** 案件の画面のダイアログ（削除・ダウンロードの履歴・変換の元の確かめ）。開くかは ui.dialogs（ダウンロードの前の確認は段の中身） */
export function CaseDialogs({ customer, fiscalYear }: { customer: { id: string; name: string }; fiscalYear: number }) {
  const router = useRouter()
  const { config, actions } = useCaseSession()
  const deleteOpen = useCase((s) => s.ui.dialogs.delete)
  return (
    <>
      <DeleteDialog
        open={deleteOpen}
        onOpenChange={actions.setDeleteOpen}
        target={{ caseId: config.caseId }}
        title={`${fiscalYear}年度の案件`}
        customerName={customer.name}
        onDeleted={() => router.navigate({ to: "/csv/customers/$customerId", params: { customerId: customer.id } })}
      />
      <SourceConfirmDialog />
      <DownloadsDialog />
    </>
  )
}

/** 「変換の元にしますか」（今の変換の結果と手直しが消える。付けるだけにもできる） */
function SourceConfirmDialog() {
  const actions = useCaseActions()
  // 一度に複数付けたら、先頭から1つずつ聞く
  const pending = useCase((s) => s.ui.dialogs.pendingSources[0] ?? null)
  return (
    <AlertDialog open={!!pending} onOpenChange={(open) => !open && pending && actions.confirmSource(pending.id, false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>変換の元を「{pending?.name}」にしますか</AlertDialogTitle>
          <AlertDialogDescription>今の変換の結果と手直しは消えます（設定は残ります）。参考に付けるだけなら「付けるだけ」。</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="source-keep">付けるだけ</AlertDialogCancel>
          <AlertDialogAction onClick={() => pending && actions.confirmSource(pending.id, true)} data-testid="source-replace">
            変換の元にする
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
