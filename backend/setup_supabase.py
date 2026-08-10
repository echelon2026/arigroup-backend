#!/usr/bin/env python3
"""
Setup script to initialize Supabase database tables and storage buckets
"""
import os
import requests
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")

if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
    print("❌ Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env")
    exit(1)

# Initialize Supabase client
supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

print("🚀 Setting up ARIGroup Supabase database...")
print(f"Project URL: {SUPABASE_URL}")

# SQL to create tables
create_tables_sql = """
DROP TABLE IF EXISTS qr_codes CASCADE;
DROP TABLE IF EXISTS ar_models CASCADE;
DROP TABLE IF EXISTS restaurants CASCADE;

CREATE TABLE restaurants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  address TEXT,
  city TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  subscription_active BOOLEAN DEFAULT true,
  subscription_end TIMESTAMP
);

CREATE TABLE ar_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  file_path TEXT NOT NULL,
  file_type TEXT,
  file_size INTEGER,
  scale FLOAT DEFAULT 1.0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE qr_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  model_id UUID NOT NULL REFERENCES ar_models(id) ON DELETE CASCADE,
  code_url TEXT NOT NULL,
  qr_image_path TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  scans INTEGER DEFAULT 0
);

CREATE INDEX idx_ar_models_restaurant_id ON ar_models(restaurant_id);
CREATE INDEX idx_qr_codes_restaurant_id ON qr_codes(restaurant_id);
CREATE INDEX idx_qr_codes_model_id ON qr_codes(model_id);
"""

try:
    print("\n📊 Creating database tables...")
    headers = {
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json"
    }

    sql_url = f"{SUPABASE_URL}/rest/v1/rpc/sql"
    response = requests.post(
        f"{SUPABASE_URL}/rest/v1/rpc/sql",
        headers=headers,
        json={"query": create_tables_sql}
    )

    if response.status_code in [200, 201]:
        print("✅ Database tables created successfully")
    else:
        print(f"⚠️  Tables creation note: {response.text}")
        print("   (You may need to create tables manually via Supabase dashboard)")

except Exception as e:
    print(f"⚠️  Tables creation note: {e}")
    print("   (You may need to create tables manually via Supabase dashboard)")

try:
    print("\n📦 Creating storage buckets...")
    headers = {
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json"
    }

    # Create ar-models bucket
    try:
        response = requests.post(
            f"{SUPABASE_URL}/storage/v1/b",
            headers=headers,
            json={"name": "ar-models", "public": True}
        )
        if response.status_code in [200, 201]:
            print("✅ Storage bucket 'ar-models' created")
        elif "already exists" in response.text:
            print("✅ Storage bucket 'ar-models' already exists")
        else:
            print(f"⚠️  ar-models: {response.text}")
    except Exception as e:
        print(f"⚠️  ar-models: {e}")

    # Create qr-codes bucket
    try:
        response = requests.post(
            f"{SUPABASE_URL}/storage/v1/b",
            headers=headers,
            json={"name": "qr-codes", "public": True}
        )
        if response.status_code in [200, 201]:
            print("✅ Storage bucket 'qr-codes' created")
        elif "already exists" in response.text:
            print("✅ Storage bucket 'qr-codes' already exists")
        else:
            print(f"⚠️  qr-codes: {response.text}")
    except Exception as e:
        print(f"⚠️  qr-codes: {e}")

    print("\n✅ Supabase setup initiated!")
    print("\n📝 Next steps:")
    print("  1. If tables weren't created, go to Supabase dashboard → SQL Editor")
    print("  2. Paste and run the SQL from backend/setup_supabase.py (lines 33-70)")
    print("  3. Start backend: cd backend && source venv/bin/activate && python app.py")
    print("  4. Start frontend: cd frontend && npm install && npm start")

except Exception as e:
    print(f"Error: {e}")
