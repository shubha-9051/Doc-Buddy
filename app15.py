from fastapi import FastAPI, Body
import os
import json
from langchain_groq import ChatGroq
from crewai import Agent, Task, Crew, Process

# Set the Groq API key
os.environ["GROQ_API_KEY"] = "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"

llm = ChatGroq(
    api_key=os.environ["GROQ_API_KEY"],
    model_name="llama3-8b-8192"
)

# Creating agent
medical_expert = Agent(
    role='Medical Expert',
    goal='Analyze symptoms and provide specific medical advice and medicine names.',
    backstory='You are an AI medical expert specialized in analyzing patient symptoms and providing appropriate medical advice or recommendations, including specific medicine brand names in a simple message.',
    verbose=True,
    llm=llm,
    allow_delegation=False
)

# Creating task
medical_analysis_task = Task(
    description='Analyze the patient\'s query from the input data. Provide specific medical advice with brand names. If it\'s not a medical query, return a message saying "I can only help with medical queries".',
    expected_output='A simple message containing the medical advice with brand names (if medications are recommended)for medical queries, or a message for non-medical queries.',
    agent=medical_expert
)

# Define the crew
MedicalCrew = Crew(
    agents=[medical_expert],
    tasks=[medical_analysis_task],
    process=Process.sequential
)

app = FastAPI()

@app.post("/receive-transcription")
async def receive_transcription(patient_data: dict = Body(...)):
    try:
        # Save the received JSON data to a file
        with open("patient_input.json", "w") as f:
            json.dump(patient_data, f, indent=2)

        # Process the patient data
        result = process_query(patient_data)

        # Save the medical response to a file
        with open("medical_response.json", "w") as f:
            json.dump(result, f, indent=2)

        # Return the medical response
        return result
    except Exception as e:
        return {"response": f"An error occurred: {str(e)}"}

def process_query(patient_data):
    # Check if the query is medical
    if "symptoms" not in patient_data or not patient_data["symptoms"]:
        return {"advice": "I can only help with medical queries"}

    # Extract symptoms from the patient data
    symptoms = patient_data["symptoms"]
    if isinstance(symptoms, str):
        symptoms = [symptoms]

    # Prepare input for the medical crew
    input_data = {"patient_symptoms": json.dumps({"symptoms": symptoms})}
    
    # Execute the task with the patient data
    result = MedicalCrew.kickoff(inputs=input_data)

    # Process the result
    medical_response = process_medical_response(result)

    return {"advice": medical_response}

def process_medical_response(result):
    # Check if the result is already a string
    if isinstance(result, str):
        return result

    # If it's a dict, try to extract the relevant information
    if isinstance(result, dict):
        if "response" in result:
            return result["response"]
        elif "advice" in result:
            return result["advice"]
        elif "medical_advice" in result:
            return result["medical_advice"]
        else:
            # If we can't find a specific key, return the whole dict as a single key-value pair
            return json.dumps(result)

    # If it's neither a string nor a dict, convert it to a string
    return str(result)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="https://d8c7-119-161-98-139.ngrok-free.app", port=8000)
