from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Any
import shutil
import os
import tempfile

from audio_processor import AudioProcessor
from isa_compiler import ISACompiler

app = FastAPI()

# Configure CORS for frontend development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify your frontend URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

audio_processor = AudioProcessor()
isa_compiler = ISACompiler()

# Models
class ISAData(BaseModel):
    segments: List[Any]

@app.get("/")
def read_root():
    return {"message": "CS Light Backend is running"}

@app.post("/api/analyze-audio")
async def analyze_audio(file: UploadFile = File(...)):
    """
    Receives an audio file, saves it temporarily, and analyzes beats.
    Returns beat timestamps and other metadata.
    """
    try:
        # Save temp file
        with tempfile.NamedTemporaryFile(delete=False, suffix=os.path.splitext(file.filename)[1]) as tmp:
            shutil.copyfileobj(file.file, tmp)
            tmp_path = tmp.name

        try:
            # Process audio
            y, sr = audio_processor.load_audio(tmp_path)
            beat_info = audio_processor.detect_beats(y, sr)
            waveform_meta = audio_processor.get_waveform_data(y, sr)
            
            return {
                "filename": file.filename,
                "duration": waveform_meta["duration"],
                "sample_rate": waveform_meta["sample_rate"],
                "tempo": beat_info["tempo"],
                "beats": beat_info["beat_times"]
            }
        finally:
            # Cleanup temp file
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
                
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/compile")
async def compile_isa(data: ISAData):
    """
    Receives ISA configuration and returns a compiled binary file.
    In a real app, you might return a file download response or save to 'output/'.
    """
    try:
        binary_content = isa_compiler.compile_to_binary(data.segments)
        
        # For demonstration, let's write to output folder
        output_dir = "../output"
        os.makedirs(output_dir, exist_ok=True)
        output_path = os.path.join(output_dir, "pattern.bin")
        
        with open(output_path, "wb") as f:
            f.write(binary_content)
            
        return {"status": "success", "file_path": output_path, "size": len(binary_content)}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

