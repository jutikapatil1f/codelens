import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { AiService } from './analysis/ai.service';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let controller: AppController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        {
          provide: getDataSourceToken(),
          useValue: { query: jest.fn() },
        },
        {
          provide: AiService,
          useValue: { describeModel: jest.fn() },
        },
      ],
    }).compile();

    controller = module.get<AppController>(AppController);
  });

  it('reports that the API is healthy', () => {
    expect(controller.getHealth()).toEqual({ status: 'ok' });
  });
});
