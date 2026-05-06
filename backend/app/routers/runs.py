from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import JobRun, Result
from ..schemas import JobRunOut, ResultOut

router = APIRouter(prefix="/runs", tags=["runs"])


@router.get("/{run_id}", response_model=JobRunOut)
def get_run(run_id: int, db: Session = Depends(get_db)):
    run = db.get(JobRun, run_id)
    if not run:
        raise HTTPException(404)
    return run


@router.get("/{run_id}/results", response_model=list[ResultOut])
def get_results(
    run_id: int,
    keyword: str | None = Query(None),
    engine: str | None = Query(None),
    db: Session = Depends(get_db),
):
    q = db.query(Result).filter(Result.run_id == run_id)
    if keyword:
        q = q.filter(Result.keyword == keyword)
    if engine:
        q = q.filter(Result.engine == engine)
    return q.order_by(Result.keyword, Result.engine, Result.device, Result.position).all()


@router.delete("/{run_id}")
def delete_run(run_id: int, db: Session = Depends(get_db)):
    run = db.get(JobRun, run_id)
    if not run:
        raise HTTPException(404)
    db.delete(run)
    db.commit()
    return {"ok": True}
