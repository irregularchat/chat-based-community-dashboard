from db.database import engine, Base
from models.user import User

def init_db():
    Base.metadata.create_all(bind=engine) 