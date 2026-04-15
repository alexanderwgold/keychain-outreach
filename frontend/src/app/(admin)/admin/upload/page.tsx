import { CsvUploadForm } from "@/components/admin/csv-upload-form"

export default function CsvUploadPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-kc-charcoal">CSV Upload</h1>
        <p className="mt-1 text-kc-text-muted">
          Import contacts and opportunities from Salesforce
        </p>
      </div>

      <CsvUploadForm />
    </div>
  )
}
