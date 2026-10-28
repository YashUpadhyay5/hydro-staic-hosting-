FROM node:18-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

# Ensure uploads directory exists
RUN mkdir -p uploads

EXPOSE 8000

CMD ["npm", "start"]
