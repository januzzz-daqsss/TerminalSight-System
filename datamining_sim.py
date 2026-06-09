import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
from sklearn.cluster import KMeans

print("Generating SlotSight Data...")

# --- DATA GENERATION (Mock SlotSight Data) ---
np.random.seed(42)
arrival_hours = np.random.uniform(6, 20, 200)
durations = np.random.normal(15, 5, 200) + (arrival_hours > 16) * 10 
df = pd.DataFrame({'ArrivalHour': arrival_hours, 'Duration': durations})
df['Duration'] = df['Duration'].clip(lower=5) 

# --- K-MEANS ALGORITHM PROCESSING ---
k_clusters = 3 # You can change this number (2, 3, 4, etc.) to show different results!
kmeans = KMeans(n_clusters=k_clusters, random_state=42, n_init=10)
df['Cluster'] = kmeans.fit_predict(df[['ArrivalHour', 'Duration']])
centroids = kmeans.cluster_centers_

print(f"Algorithm finished sorting data into {k_clusters} clusters. Opening Graph...")

# --- GRAPH VISUALIZATION ---
plt.figure(figsize=(10, 6))
plt.scatter(df['ArrivalHour'], df['Duration'], c=df['Cluster'], cmap='viridis', alpha=0.7, edgecolors='k')
plt.scatter(centroids[:, 0], centroids[:, 1], c='red', marker='X', s=200, label='Cluster Centroids')

plt.xlabel("Arrival Hour (24H Format: 6 = 6 AM, 18 = 6 PM)")
plt.ylabel("Turnaround Duration (Minutes)")
plt.title(f"SlotSight: K-Means Clustering (K={k_clusters})")
plt.grid(True, linestyle='--', alpha=0.5)
plt.legend()

# This forces the graph to pop up as a desktop application!
plt.show()