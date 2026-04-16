import { CsvUploadForm } from "@/components/admin/csv-upload-form"
import { MetabaseUploadForm } from "@/components/admin/metabase-upload-form"
import { Separator } from "@/components/ui/separator"

export default function CsvUploadPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-kc-charcoal">Data Import</h1>
        <p className="mt-1 text-kc-text-muted">
          Import data from Salesforce and Metabase
        </p>
      </div>

      <CsvUploadForm />

      <Separator />

      <MetabaseUploadForm />
    </div>
  )
}
