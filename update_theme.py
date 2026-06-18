import os
import glob

files = glob.glob('src/**/*.tsx', recursive=True)
for f in files:
    with open(f, 'r', encoding='utf-8') as file:
        content = file.read()
    
    # Global Panabo Colors
    content = content.replace('indigo-', 'emerald-')
    content = content.replace('sky-', 'amber-')
    
    # Write back safely
    with open(f, 'w', encoding='utf-8') as file:
        file.write(content)
        
print("Theme successfully updated globally.")
