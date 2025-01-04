from fastapi import FastAPI, Body, HTTPException
import os
from langchain_groq import ChatGroq
from crewai import Agent, Task, Crew, Process
import uvicorn

# Set the Groq API key
os.environ["GROQ_API_KEY"] = ""

llm = ChatGroq(
    api_key=os.environ["GROQ_API_KEY"],
    model_name="llama3-8b-8192"
)

# Creating agent
medical_expert = Agent(
    role='Medical Expert',
    goal='Analyze symptoms and provide brief, specific medical advice with brand names',
    backstory='You are an AI medical expert specialized in analyzing patient symptoms and providing brief, appropriate medical advice or recommendations, including specific medicine brand names.',
    verbose=False,
    llm=llm,
    allow_delegation=False
)

# Creating task
medical_analysis_task = Task(
    description='Analyze the patient\'s symptoms and provide brief, specific medical advice with brand names. If it is not a medical query, return a message saying "I can only help with medical queries".',
    expected_output='A brief string containing specific medical advice with brand names for medical queries, or a short message for non-medical queries.',
    agent=medical_expert
)

# Define the crew
MedicalCrew = Crew(
    agents=[medical_expert],
    tasks=[medical_analysis_task],
    process=Process.sequential
)

app = FastAPI()

@app.post("/process-query")
async def process_query(data: dict = Body(...)):
    if not isinstance(data, dict) or "query" not in data:
        raise HTTPException(status_code=400, detail="Invalid input format. Please provide a JSON object with a 'query' key.")
    
    query = data.get("query", "")
    
    if not query:
        return {"response": "No query provided"}

    try:
        result = analyze_query(query)
        return {"response": result}
    except Exception as e:
        return {"response": f"An error occurred: {str(e)}"}

def analyze_query(query):
    input_data = {"patient_symptoms": query}
    result = MedicalCrew.kickoff(inputs=input_data)
    return process_medical_response(result)

def process_medical_response(result):
    if isinstance(result, str):
        return result.strip()
    elif isinstance(result, dict):
        return next((result[key].strip() for key in ['response', 'advice', 'medical_advice'] if key in result), "I'm sorry, I couldn't provide specific medical advice for your symptoms.")
    return "I'm sorry, I couldn't provide specific medical advice for your symptoms."

if __name__ == "__main__":
    uvicorn.run(app, host="https://d8c7-119-161-98-139.ngrok-free.app", port=8000)
