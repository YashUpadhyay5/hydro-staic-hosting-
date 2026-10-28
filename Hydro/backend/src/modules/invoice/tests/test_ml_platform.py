import sys
import os
import json

# Add backend directory to Python path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from database import SessionLocal
from services.extraction_sync_service import ExtractionSyncService
from services.dataset_builder_service import DatasetBuilderService
from models.extractions import RawAIExtraction, UserVerifiedExtraction

def run_tests():
    db = SessionLocal()
    sync_service = ExtractionSyncService()
    builder_service = DatasetBuilderService()
    
    test_doc_id = "test-doc-1234"
    
    # Clean up any existing test records
    db.query(RawAIExtraction).filter(RawAIExtraction.document_id == test_doc_id).delete()
    db.query(UserVerifiedExtraction).filter(UserVerifiedExtraction.document_id == test_doc_id).delete()
    db.commit()

    print("="*60)
    print("RUNNING ENTERPRISE ML PLATFORM UNIT TESTS")
    print("="*60)

    # Test 1: Register raw prediction (v1)
    print("Test 1: Syncing raw AI prediction (v1)...")
    ai_data = {
        "vendor_details": {"name": "KRISHNA TRADING CORP", "gstin": "03AAECK3185L1ZI"},
        "invoice_details": {"invoice_number": "354", "invoice_date": "18-05-2026"},
        "items": [
            {"description": "D/JOINT 6 C I RING", "quantity": 3.0, "total_amount": 2407.2}
        ]
    }
    raw_rec_v1 = sync_service.sync_raw_prediction(
        db=db,
        document_id=test_doc_id,
        extraction_data=ai_data,
        raw_ocr_text="KRISHNA TRADING CORP INVOICE 354 Qty 3.0 Total 2407.2",
        confidence_score=0.92,
        inference_time_ms=120
    )
    assert raw_rec_v1.version == 1, "Raw AI prediction version should be 1"
    print("-> Raw prediction v1 synced successfully.")

    # Test 2: Register raw prediction (v2) - testing version auto-increment
    print("\nTest 2: Syncing second raw AI prediction (v2)...")
    raw_rec_v2 = sync_service.sync_raw_prediction(
        db=db,
        document_id=test_doc_id,
        extraction_data=ai_data,
        confidence_score=0.95
    )
    assert raw_rec_v2.version == 2, "Raw AI prediction version should auto-increment to 2"
    print("-> Version increment test passed.")

    # Test 3: Sync user verification with corrections
    print("\nTest 3: Syncing user corrected verification...")
    corrected_user_data = {
        "vendor_details": {"name": "KRISHNA TRADING CORP LTD", "gstin": "03AAECK3185L1ZI"}, # Name corrected
        "invoice_details": {"invoice_number": "354", "invoice_date": "18-05-2026"},
        "items": [
            {"description": "D/JOINT 6 C I RING", "quantity": 3.0, "total_amount": 2407.2}
        ]
    }
    
    verified_rec = sync_service.sync_user_verification(
        db=db,
        document_id=test_doc_id,
        verified_data=corrected_user_data,
        user_info={"username": "reviewer_aman", "role": "Lead Reviewer"},
        correction_reason="Vendor name suffix 'LTD' was missing in OCR"
    )
    
    print(f"-> Verified Record ID: {verified_rec.id}")
    print(f"-> Accuracy Metric Calculated: {verified_rec.field_accuracy}%")
    print(f"-> Was Corrected Flag: {verified_rec.was_corrected}")
    print(f"-> Changed Fields Tracked: {verified_rec.changed_fields}")
    
    assert verified_rec.was_corrected == True, "was_corrected should be True"
    assert verified_rec.number_of_fields_changed == 1, "Should count 1 field changed"
    assert "vendor_details.name" in verified_rec.changed_fields, "Should identify vendor name correction"
    print("-> Accuracy calculations and change tracking tests passed.")

    # Test 4: Export to instruction tuning JSONL dataset
    print("\nTest 4: Exporting approved dataset to JSONL format...")
    output_dataset_path = "./dataset/test_finetuning.jsonl"
    
    # Mark test record as approved for export
    verified_rec.training_status = "approved"
    db.commit()
    
    export_count = builder_service.build_instruction_tuning_dataset(
        db=db,
        output_filepath=output_dataset_path,
        status="approved"
    )
    
    print(f"-> Exported {export_count} records to {output_dataset_path}")
    assert export_count >= 1, "Should export at least the test record"
    
    # Read and print the JSONL output snippet
    with open(output_dataset_path, "r", encoding="utf-8") as f:
        jsonl_lines = f.readlines()
        print("Dataset Line Snippet:")
        print(jsonl_lines[-1])
        
    print("-> JSONL training dataset build test passed.")
    print("="*60)
    print("ALL TESTS PASSED SUCCESSFULLY!")
    print("="*60)

if __name__ == "__main__":
    run_tests()
