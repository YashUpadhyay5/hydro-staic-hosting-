import React, { useState } from "react";
import ExcelDateRangeModal from "./ExcelDateRangeModal";

function ExportButtons() {
  const [showModal, setShowModal] = useState(false);

  return (
    <div className="export-buttons">
      <button onClick={() => setShowModal(true)}>
        Download Excel
      </button>

      <ExcelDateRangeModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
      />
    </div>
  );
}

export default ExportButtons;
