import pandas as pd, numpy as np
from sklearn.linear_model import LogisticRegression, LinearRegression
from sklearn.metrics import log_loss, brier_score_loss
cols=['game_id','season','home_team','posteam','down','ydstogo','yardline_100','game_seconds_remaining','score_differential','spread_line','result','ep','vegas_wp','play_type','qtr']
D=pd.concat([pd.read_csv(f'/tmp/pbp{y}.csv.gz',usecols=cols,low_memory=False) for y in range(2021,2026)])
D=D[D.posteam.notna()&D.down.notna()&D.score_differential.notna()&D.result.notna()&(D.result!=0)&D.spread_line.notna()&D.ep.notna()&D.yardline_100.notna()]
D=D[D.play_type.isin(['pass','run','punt','field_goal','qb_kneel','qb_spike','no_play'])]
home=D.posteam==D.home_team
D['win']=np.where(home,D.result>0,D.result<0).astype(int)
D['mu']=np.where(home,D.spread_line,-D.spread_line)
D['r']=D.game_seconds_remaining.clip(lower=0)/3600
yl=D.yardline_100.values; dn=D.down.values; dist=D.ydstogo.clip(1,40).values
def epX(yl,dn,dist):
    ld=np.log(dist)
    return np.column_stack([yl,yl**2/100,yl**3/1e4,dn==2,dn==3,dn==4,ld,(dn==3)*ld,(dn==4)*ld,(dn==4)*(yl<=35),np.minimum(yl,10)])
X=epX(yl,dn,dist); er=LinearRegression().fit(X,D.ep.values)
D['myep']=er.predict(X)
print('EP R2',er.score(X,D.ep.values)); print('EP coef',np.round(er.intercept_,4),np.round(er.coef_,5).tolist())
def wpX(d):
    s=np.sqrt(d.r+0.0025)
    L=((d.score_differential>0)&(d.game_seconds_remaining<=120)).astype(float); t=(120-d.game_seconds_remaining.clip(0,120))/120
    return np.column_stack([d.score_differential/s,d.myep/s,d.mu*s,d.score_differential,d.myep,d.mu,(d.score_differential+d.myep)*(d.r<0.05),L,L*t,L*(d.score_differential<=8)])
tr=D[D.season<2025]; te=D[D.season==2025]
m=LogisticRegression(C=10,max_iter=2000).fit(wpX(tr),tr.win)
p=m.predict_proba(wpX(te))[:,1]
v=te.vegas_wp.clip(.001,.999)
print('2025 holdout  ours logloss %.4f brier %.4f | nflfastR vegas_wp logloss %.4f brier %.4f'%(log_loss(te.win,p),brier_score_loss(te.win,p),log_loss(te.win,v),brier_score_loss(te.win,v)))
# stern baseline
from scipy.stats import norm
def stern(d): r=d.r.clip(lower=1/3600); return norm.cdf((d.score_differential+d.myep+d.mu*r)/np.sqrt(13.45**2*r+24*r*(1-r)))
print('simple normal model logloss %.4f'%log_loss(te.win,stern(te).clip(.001,.999)))
m2=LogisticRegression(C=10,max_iter=2000).fit(wpX(D),D.win)
print('WP intercept',round(m2.intercept_[0],5),'coef',np.round(m2.coef_[0],5).tolist())
# calibration
te=te.assign(p=p); te['b']=(te.p*10).clip(0,9.99).astype(int)
print(te.groupby('b').agg(n=('win','size'),pred=('p','mean'),act=('win','mean')).round(3).to_string())
np.save('/tmp/wpfit/coef2.npy',np.r_[er.intercept_,er.coef_,m2.intercept_,m2.coef_[0]])
