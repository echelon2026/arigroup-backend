# ARIGroup - Digital Menu AR Platform

A platform for restaurants to create and share AR menu experiences using QR codes.

## Project Structure

```
arigroup-space/
├── backend/          # Python FastAPI backend
│   ├── app.py       # Main FastAPI application
│   ├── models.py    # Database models
│   └── requirements.txt
└── frontend/        # React dashboard
    ├── src/
    └── public/
```

## Setup

### Backend Setup

1. Navigate to backend directory:
```bash
cd backend
source venv/bin/activate
pip install -r requirements.txt
```

2. Create `.env` file (copy from `.env.example`):
```bash
cp .env.example .env
```

3. Fill in your Supabase credentials:
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-anon-key
SUPABASE_SERVICE_KEY=your-service-key
```

4. Run the backend:
```bash
python app.py
```

The API will be available at `http://localhost:8000`

### Frontend Setup

1. Navigate to frontend directory:
```bash
cd frontend
npm install
```

2. Create `.env` file:
```bash
cp .env.example .env
```

3. Run the development server:
```bash
npm start
```

The dashboard will be available at `http://localhost:3000`

## Supabase Setup

1. Go to [Supabase](https://supabase.com) and create a new project
2. Create these tables:

**restaurants table:**
- id (uuid, primary key)
- name (text)
- email (text, unique)
- phone (text)
- address (text)
- city (text)
- created_at (timestamp)
- subscription_active (boolean)
- subscription_end (timestamp)

**ar_models table:**
- id (uuid, primary key)
- restaurant_id (uuid, foreign key)
- name (text)
- description (text)
- file_path (text)
- file_type (text)
- file_size (integer)
- scale (float)
- created_at (timestamp)
- updated_at (timestamp)

**qr_codes table:**
- id (uuid, primary key)
- restaurant_id (uuid, foreign key)
- model_id (uuid, foreign key)
- code_url (text)
- qr_image_path (text)
- created_at (timestamp)
- scans (integer)

3. Create storage buckets:
   - `ar-models` (for 3D model files)
   - `qr-codes` (for QR code images)

## API Endpoints

- `POST /restaurants` - Register a new restaurant
- `GET /restaurants/{restaurant_id}` - Get restaurant details
- `POST /models/upload` - Upload a 3D model
- `GET /models/{restaurant_id}` - List models for a restaurant
- `POST /qr/{model_id}` - Generate QR code
- `GET /model/{model_id}` - Get model download URL

## Supported File Formats

- OBJ (.obj)
- glTF (.gltf)
- Binary glTF (.glb)

## Next Steps

1. Set up Supabase project with tables and storage
2. Add Supabase credentials to backend `.env`
3. Build the WebAR viewer (React component for scanning and viewing AR)
4. Add mesh cleanup/optimization tools (Phase 2)
