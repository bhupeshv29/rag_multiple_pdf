'use client';
import * as React from 'react';
import { Upload } from 'lucide-react';

const FileUploadComponent: React.FC = () => {
  const [uploading, setUploading] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);

  const handleFileUploadButtonClick = () => {
    const el = document.createElement('input');
    el.setAttribute('type', 'file');
    el.setAttribute('accept', 'application/pdf');
    el.setAttribute('multiple', 'true');
    el.addEventListener('change', async () => {
      if (el.files && el.files.length > 0) {
        setUploading(true);
        setMessage(null);

        try {
          const formData = new FormData();
          const files = Array.from(el.files);
          files.forEach((file) => formData.append('pdf', file));

          const res = await fetch('http://localhost:8000/upload/pdf', {
            method: 'POST',
            body: formData,
          });

          const data = await res.json();

          if (data.success) {
            setMessage(
              `${data.count} PDF${data.count > 1 ? 's' : ''} uploaded. Indexing in the background...`,
            );
          } else {
            setMessage(`Upload failed: ${data.message ?? 'unknown error'}`);
          }
        } catch (err) {
          console.error(err);
          setMessage('Upload failed. Is the server running?');
        } finally {
          setUploading(false);
        }
      }
    });
    el.click();
  };

  return (
    <div className="bg-slate-900 text-white shadow-2xl flex justify-center items-center p-4 rounded-lg border-white border-2 flex-col gap-3">
      <div
        onClick={handleFileUploadButtonClick}
        className="flex justify-center items-center flex-col cursor-pointer"
      >
        <h3>{uploading ? 'Uploading...' : 'Upload PDF Files'}</h3>
        <Upload className={uploading ? 'animate-pulse' : ''} />
        <p className="text-xs text-slate-300 mt-1">
          You can select multiple PDFs at once
        </p>
      </div>

      {message && <p className="text-xs text-center text-slate-200">{message}</p>}
    </div>
  );
};

export default FileUploadComponent;
