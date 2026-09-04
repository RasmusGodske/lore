import { Module } from "@nestjs/common";
import { GuideController } from "./guide.controller";

@Module({ controllers: [GuideController] })
export class GuideModule {}
