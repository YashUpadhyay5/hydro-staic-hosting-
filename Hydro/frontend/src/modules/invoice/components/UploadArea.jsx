import API from "../services/api";

function UploadArea({ reloadDocuments }) {
  const uploadFiles = async (event) => {
    const files = event.target.files;

    if (!files.length) return;

    const formData = new FormData();

    for (let file of files) {
      formData.append(
        "files",
        file
      );
    }

    try {
      await API.post(
        "/upload",
        formData,
        {
          headers: {
            "Content-Type":
              "multipart/form-data",
          },
        }
      );

      reloadDocuments();
    } catch (error) {
      console.error(error);
      alert("Upload Failed");
    }
  };

  return (
    <div className="upload-area">
      <input
        type="file"
        multiple
        onChange={uploadFiles}
      />
    </div>
  );
}

export default UploadArea;
