import { useEffect, useState } from "react";

function OCRForm({
  document
}) {

  const [
    data,
    setData
  ] = useState(null);

  useEffect(() => {

    if (
      document &&
      document.ocr_result
    ) {

      setData(
        document.ocr_result
      );

    }

  }, [document]);

  if (!data) {

    return (
      <div>
        No OCR Result
      </div>
    );

  }

  const extraction =
    data.extraction;

  return (
    <div>

      <h2>
        Vendor Details
      </h2>

      <div>
        <strong>Name:</strong>
        {" "}
        {
          extraction
            ?.vendor_details
            ?.name
        }
      </div>

      <div>
        <strong>GSTIN:</strong>
        {" "}
        {
          extraction
            ?.vendor_details
            ?.gstin
        }
      </div>

      <div>
        <strong>Address:</strong>
        {" "}
        {
          extraction
            ?.vendor_details
            ?.address
        }
      </div>

      <hr />

      <h2>
        Invoice Details
      </h2>

      <div>
        <strong>Invoice No:</strong>
        {" "}
        {
          extraction
            ?.invoice_details
            ?.invoice_number
        }
      </div>

      <div>
        <strong>Invoice Date:</strong>
        {" "}
        {
          extraction
            ?.invoice_details
            ?.invoice_date
        }
      </div>

      <hr />

      <h2>
        Items
      </h2>

      <table
        border="1"
        width="100%"
      >
        <thead>

          <tr>
            <th>
              Description
            </th>

            <th>
              HSN
            </th>

            <th>
              Qty
            </th>

            <th>
              Unit
            </th>

            <th>
              Total
            </th>
          </tr>

        </thead>

        <tbody>

          {
            extraction
              ?.items
              ?.map(
                (
                  item,
                  index
                ) => (
                  <tr
                    key={index}
                  >

                    <td>
                      {
                        item.description
                      }
                    </td>

                    <td>
                      {
                        item.hsn_code
                      }
                    </td>

                    <td>
                      {
                        item.quantity
                      }
                    </td>

                    <td>
                      {
                        item.unit
                      }
                    </td>

                    <td>
                      {
                        item.total_amount
                      }
                    </td>

                  </tr>
                )
              )
          }

        </tbody>

      </table>

    </div>
  );
}

export default OCRForm;
