
def create_app():
    return app

if __name__ == "__main__":
    import uvicorn
    # Allow running directly for debug
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
