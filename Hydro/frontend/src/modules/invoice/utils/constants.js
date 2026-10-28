export const STATUS = {
  PENDING: "Pending",
  PROCESSING: "Processing",
  PROCESSED: "Processed",
  SAVED: "Saved",
  FAILED: "Failed",
};

/**
 * Utility to download original invoice document directly to user's local device/storage.
 * Uses blob conversion to guarantee native browser download behavior without opening in new tab.
 */
export async function downloadInvoiceFile(docOrId, customFilename) {
  let docId = "";
  let filename = "";

  if (typeof docOrId === "object" && docOrId !== null) {
    docId = docOrId.document_id || docOrId.id || "";
    filename = docOrId.filename || customFilename || "";
  } else if (typeof docOrId === "string") {
    docId = docOrId;
    filename = customFilename || "";
  }

  if (!docId || docId === "temp-uploading") {
    console.warn("Cannot download document: invalid document ID.");
    return false;
  }

  const token = localStorage.getItem("token") || localStorage.getItem("adminToken") || "";
  const apiBaseUrl = (import.meta.env && import.meta.env.VITE_API_URL)
    ? `${import.meta.env.VITE_API_URL.replace(/\/$/, '')}/v1/invoice`
    : `/api/v1/invoice`;

  const downloadUrl = `${apiBaseUrl}/documents/${docId}/file?download=true&token=${encodeURIComponent(token)}`;

  try {
    const response = await fetch(downloadUrl, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });

    if (!response.ok) {
      throw new Error(`Download HTTP error ${response.status}`);
    }

    const blob = await response.blob();
    const blobUrl = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = blobUrl;

    let dlName = filename ? filename.trim() : "invoice";
    if (!dlName.includes(".")) {
      const type = (blob.type || "").toLowerCase();
      if (type.includes("pdf")) dlName += ".pdf";
      else if (type.includes("png")) dlName += ".png";
      else if (type.includes("jpeg") || type.includes("jpg")) dlName += ".jpg";
      else if (type.includes("svg")) dlName += ".svg";
      else dlName += ".pdf";
    }

    link.setAttribute("download", dlName);
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();

    setTimeout(() => {
      if (document.body.contains(link)) {
        document.body.removeChild(link);
      }
      window.URL.revokeObjectURL(blobUrl);
    }, 2000);

    return true;
  } catch (err) {
    console.warn("Direct blob download failed, attempting fallback:", err);
    const fallbackLink = document.createElement("a");
    fallbackLink.href = downloadUrl;
    fallbackLink.setAttribute("download", filename || "invoice");
    fallbackLink.target = "_blank";
    document.body.appendChild(fallbackLink);
    fallbackLink.click();
    setTimeout(() => {
      if (document.body.contains(fallbackLink)) {
        document.body.removeChild(fallbackLink);
      }
    }, 2000);
    return false;
  }
}

